from fastapi import FastAPI
from fastapi.testclient import TestClient

from verdict_service.api.health import create_health_router
from verdict_service.health import HealthTracker


def make_client(tracker: HealthTracker, store: str = "memory") -> TestClient:
    app = FastAPI()
    app.include_router(create_health_router(tracker, store))
    return TestClient(app)


def test_reports_ok_before_any_recompute_has_run():
    response = make_client(HealthTracker()).get("/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["recompute"] is None


def test_reports_the_configured_store_backend():
    body = make_client(HealthTracker(), store="sqlite").get("/v1/health").json()
    assert body["store"] == "sqlite"


def test_reports_ok_with_the_last_successful_recompute():
    tracker = HealthTracker()
    tracker.record_success(7, now=lambda: 1234.0)
    body = make_client(tracker).get("/v1/health").json()
    assert body["status"] == "ok"
    assert body["recompute"] == {
        "lastCompletedAt": 1234.0,
        "lastFlaggedCount": 7,
        "lastError": None,
    }


def test_reports_degraded_after_a_failed_recompute():
    tracker = HealthTracker()
    tracker.record_failure(RuntimeError("db locked"), now=lambda: 1234.0)
    body = make_client(tracker).get("/v1/health").json()
    assert body["status"] == "degraded"
    assert body["recompute"]["lastError"] == "db locked"
