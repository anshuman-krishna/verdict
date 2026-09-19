import pytest
from fastapi import HTTPException

from verdict_service.api.load_shedding import (
    CONCURRENCY_RETRY_AFTER_SECONDS,
    LoadShedder,
    admitted,
    shed_status,
)
from verdict_service.metrics import MetricsRegistry

# the lookup takes exactly the bucket count, and what is in them does not matter here
PREFIXES = [f"{i:04x}" for i in range(32)]


class Clock:
    def __init__(self) -> None:
        self.value = 0.0

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


def test_a_request_inside_the_burst_is_admitted():
    shedder = LoadShedder(requests_per_second=1, burst=3, now=Clock())
    assert shedder.admit() is None


def test_the_burst_is_spent_and_then_the_rate_applies():
    clock = Clock()
    shedder = LoadShedder(requests_per_second=1, burst=3, now=clock)
    for _ in range(3):
        assert shedder.admit() is None
        shedder.release()
    shed = shedder.admit()
    assert shed is not None
    assert shed.reason == "rate"
    assert shed.retry_after_seconds == 1


def test_waiting_refills_the_bucket_at_the_stated_rate():
    clock = Clock()
    shedder = LoadShedder(requests_per_second=2, burst=2, now=clock)
    for _ in range(2):
        shedder.admit()
        shedder.release()
    assert shedder.admit() is not None
    clock.advance(0.5)
    assert shedder.admit() is None


def test_the_bucket_never_fills_past_its_burst():
    clock = Clock()
    shedder = LoadShedder(requests_per_second=100, burst=2, now=clock)
    clock.advance(3600)
    for _ in range(2):
        assert shedder.admit() is None
        shedder.release()
    assert shedder.admit() is not None


def test_a_long_wait_is_asked_for_when_the_rate_is_slow():
    shedder = LoadShedder(requests_per_second=0.1, burst=1, now=Clock())
    shedder.admit()
    shedder.release()
    shed = shedder.admit()
    assert shed is not None
    assert shed.retry_after_seconds == 10


def test_requests_in_flight_are_capped_whatever_the_rate_allows():
    shedder = LoadShedder(requests_per_second=1000, burst=1000, max_concurrent=2, now=Clock())
    assert shedder.admit() is None
    assert shedder.admit() is None
    shed = shedder.admit()
    assert shed is not None
    assert shed.reason == "concurrency"
    assert shed.retry_after_seconds == CONCURRENCY_RETRY_AFTER_SECONDS


def test_releasing_a_slot_lets_the_next_request_in():
    shedder = LoadShedder(requests_per_second=1000, burst=1000, max_concurrent=1, now=Clock())
    shedder.admit()
    assert shedder.admit() is not None
    shedder.release()
    assert shedder.admit() is None


def test_a_slot_is_not_held_by_a_request_that_was_refused():
    shedder = LoadShedder(requests_per_second=1, burst=1, max_concurrent=4, now=Clock())
    shedder.admit()
    shedder.release()
    assert shedder.admit() is not None
    assert shedder.in_flight == 0


def test_release_without_admit_cannot_drive_the_count_negative():
    shedder = LoadShedder(now=Clock())
    shedder.release()
    assert shedder.in_flight == 0


def test_the_two_refusals_carry_the_status_that_says_what_happened():
    assert shed_status("rate") == 429
    assert shed_status("concurrency") == 503


def test_an_admitted_request_frees_its_slot_even_when_the_handler_raises():
    shedder = LoadShedder(requests_per_second=1000, burst=1000, max_concurrent=1, now=Clock())
    with pytest.raises(ValueError):
        with admitted(shedder):
            raise ValueError("the handler failed")
    assert shedder.in_flight == 0


def test_a_shed_request_is_counted_and_told_when_to_come_back():
    clock = Clock()
    shedder = LoadShedder(requests_per_second=1, burst=1, now=clock)
    metrics = MetricsRegistry()
    with admitted(shedder, metrics):
        pass
    with pytest.raises(HTTPException) as raised:
        with admitted(shedder, metrics):
            pass
    assert raised.value.status_code == 429
    assert raised.value.headers is not None
    assert raised.value.headers["Retry-After"] == "1"
    assert metrics.requests_shed_rate_total == 1
    assert metrics.requests_shed_concurrency_total == 0


def test_the_metrics_page_counts_both_kinds_of_refusal():
    metrics = MetricsRegistry()
    metrics.record_shed("rate")
    metrics.record_shed("concurrency")
    rendered = metrics.render_prometheus()
    assert "verdict_requests_shed_rate_total 1" in rendered
    assert "verdict_requests_shed_concurrency_total 1" in rendered


def _app_with_shedder(shedder):
    from fastapi import Depends, FastAPI

    from verdict_service.api.contribution import create_contribution_router
    from verdict_service.api.health import create_health_router
    from verdict_service.api.load_shedding import load_shedding_dependency
    from verdict_service.api.reputation import create_reputation_router
    from verdict_service.api.store import InMemoryFlaggedHashStore
    from verdict_service.graph.contribution_store import InMemoryContributionEdgeStore
    from verdict_service.health import HealthTracker

    metrics = MetricsRegistry()
    public = [Depends(load_shedding_dependency(shedder, metrics))]
    app = FastAPI()
    app.include_router(
        create_reputation_router(InMemoryFlaggedHashStore(), metrics), dependencies=public
    )
    app.include_router(
        create_contribution_router(InMemoryContributionEdgeStore(), metrics=metrics),
        dependencies=public,
    )
    app.include_router(create_health_router(HealthTracker(), "memory"))
    return app, metrics


def test_a_lookup_past_the_ceiling_is_refused_and_says_when_to_come_back():
    from fastapi.testclient import TestClient

    shedder = LoadShedder(requests_per_second=1, burst=1, now=Clock())
    app, metrics = _app_with_shedder(shedder)
    client = TestClient(app)
    body = {"prefixes": PREFIXES}

    assert client.post("/v1/reputation/lookup", json=body).status_code == 200
    refused = client.post("/v1/reputation/lookup", json=body)
    assert refused.status_code == 429
    assert refused.headers["retry-after"] == "1"
    assert metrics.requests_shed_rate_total == 1


def test_health_is_answered_whatever_the_public_endpoints_are_doing():
    from fastapi.testclient import TestClient

    shedder = LoadShedder(requests_per_second=1, burst=1, now=Clock())
    app, _ = _app_with_shedder(shedder)
    client = TestClient(app)
    client.post("/v1/reputation/lookup", json={"prefixes": PREFIXES})
    client.post("/v1/reputation/lookup", json={"prefixes": PREFIXES})
    assert client.get("/v1/health").status_code == 200


def test_a_refused_request_never_reaches_the_store():
    from fastapi.testclient import TestClient

    shedder = LoadShedder(requests_per_second=1, burst=1, now=Clock())
    app, metrics = _app_with_shedder(shedder)
    client = TestClient(app)
    edge = {
        "reviewerHash": "a" * 64,
        "productHash": "b" * 64,
        "starRating": 5,
        "weekBucket": 10,
        "verified": True,
        "minhashSignature": [],
    }
    assert client.post("/v1/graph/contribute", json={"edges": [edge]}).status_code == 200
    assert client.post("/v1/graph/contribute", json={"edges": [edge]}).status_code == 429
    assert metrics.contribution_edges_total == 1


def test_a_request_the_service_would_reject_anyway_still_spends_its_place_in_the_queue():
    from fastapi.testclient import TestClient

    shedder = LoadShedder(requests_per_second=1, burst=1, now=Clock())
    app, metrics = _app_with_shedder(shedder)
    client = TestClient(app)
    assert client.post("/v1/reputation/lookup", json={"prefixes": ["3b1f"]}).status_code == 422
    assert client.post("/v1/reputation/lookup", json={"prefixes": PREFIXES}).status_code == 429
    assert metrics.requests_shed_rate_total == 1


def test_one_slot_serves_request_after_request_when_each_one_finishes():
    from fastapi.testclient import TestClient

    shedder = LoadShedder(requests_per_second=1000, burst=1000, max_concurrent=1, now=Clock())
    app, metrics = _app_with_shedder(shedder)
    client = TestClient(app)
    for _ in range(5):
        assert client.post("/v1/reputation/lookup", json={"prefixes": PREFIXES}).status_code == 200
    assert metrics.requests_shed_concurrency_total == 0
    assert shedder.in_flight == 0
