import hashlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

from verdict_service.api.contribution import (
    RETRY_AFTER_SECONDS,
    CapacityGuard,
    create_contribution_router,
)
from verdict_service.graph.contribution_store import InMemoryContributionEdgeStore
from verdict_service.metrics import MetricsRegistry


def hex64(seed: str) -> str:
    return hashlib.sha256(seed.encode()).hexdigest()


def batch(count: int, seed: str = "r") -> dict:
    return {
        "edges": [
            {
                "reviewerHash": hex64(f"{seed}{index}"),
                "productHash": hex64("p"),
                "starRating": 4,
                "weekBucket": 2900,
                "verified": None,
                "minhashSignature": [],
            }
            for index in range(count)
        ]
    }


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def client(store, guard, metrics=None) -> TestClient:
    api = FastAPI()
    api.include_router(
        create_contribution_router(store, now=lambda: 1.0, metrics=metrics, capacity=guard)
    )
    return TestClient(api)


def test_accepts_while_there_is_room():
    store = InMemoryContributionEdgeStore()
    response = client(store, CapacityGuard(store, max_edges=10)).post(
        "/v1/graph/contribute", json=batch(3)
    )
    assert response.status_code == 200
    assert store.count() == 3


def test_refuses_with_retry_after_once_full_and_stores_nothing():
    store = InMemoryContributionEdgeStore()
    metrics = MetricsRegistry()
    http = client(store, CapacityGuard(store, max_edges=3), metrics)
    assert http.post("/v1/graph/contribute", json=batch(3)).status_code == 200

    refused = http.post("/v1/graph/contribute", json=batch(2, seed="late"))

    assert refused.status_code == 503
    assert refused.headers["retry-after"] == str(RETRY_AFTER_SECONDS)
    assert store.count() == 3
    assert metrics.contributions_refused_total == 1
    assert "verdict_contributions_refused_total 1" in metrics.render_prometheus()


def test_accepted_edges_count_before_the_next_refresh():
    store = InMemoryContributionEdgeStore()
    clock = Clock()
    guard = CapacityGuard(store, max_edges=4, now=clock, refresh_seconds=60)
    http = client(store, guard)
    assert http.post("/v1/graph/contribute", json=batch(4)).status_code == 200
    assert http.post("/v1/graph/contribute", json=batch(1, seed="x")).status_code == 503


def test_room_returns_after_pruning_once_the_count_is_refreshed():
    store = InMemoryContributionEdgeStore()
    clock = Clock()
    guard = CapacityGuard(store, max_edges=2, now=clock, refresh_seconds=60)
    http = client(store, guard)
    http.post("/v1/graph/contribute", json=batch(2))
    store.prune_older_than(10.0)

    assert http.post("/v1/graph/contribute", json=batch(1, seed="a")).status_code == 503
    clock.now = 61.0
    assert http.post("/v1/graph/contribute", json=batch(1, seed="b")).status_code == 200


def test_an_invalid_batch_is_still_a_validation_error_when_full():
    store = InMemoryContributionEdgeStore()
    http = client(store, CapacityGuard(store, max_edges=0))
    assert http.post("/v1/graph/contribute", json={"edges": []}).status_code == 422


def test_the_count_is_not_queried_on_every_request():
    calls = []

    class CountingStore(InMemoryContributionEdgeStore):
        def count(self) -> int:
            calls.append(1)
            return super().count()

    store = CountingStore()
    http = client(store, CapacityGuard(store, max_edges=1000, now=Clock()))
    for index in range(5):
        http.post("/v1/graph/contribute", json=batch(1, seed=str(index)))
    assert len(calls) == 1
