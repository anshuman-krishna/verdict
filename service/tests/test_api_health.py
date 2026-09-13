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
    assert body["backup"] is None


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


def test_reports_ok_with_the_last_successful_backup():
    tracker = HealthTracker()
    tracker.record_backup_success("/data/backups/verdict-1.db", now=lambda: 1234.0)
    body = make_client(tracker).get("/v1/health").json()
    assert body["status"] == "ok"
    assert body["backup"] == {
        "lastCompletedAt": 1234.0,
        "lastPath": "/data/backups/verdict-1.db",
        "lastError": None,
    }


def test_reports_degraded_after_a_failed_backup():
    tracker = HealthTracker()
    tracker.record_backup_failure(RuntimeError("disk full"), now=lambda: 1234.0)
    body = make_client(tracker).get("/v1/health").json()
    assert body["status"] == "degraded"
    assert body["backup"]["lastError"] == "disk full"


def test_a_successful_recompute_does_not_mask_a_failed_backup():
    tracker = HealthTracker()
    tracker.record_success(5, now=lambda: 1000.0)
    tracker.record_backup_failure(RuntimeError("disk full"), now=lambda: 2000.0)
    body = make_client(tracker).get("/v1/health").json()
    assert body["status"] == "degraded"
    assert body["recompute"]["lastError"] is None
    assert body["backup"]["lastError"] == "disk full"
