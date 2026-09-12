from fastapi import FastAPI
from fastapi.testclient import TestClient

from verdict_service.api.metrics import create_metrics_router
from verdict_service.metrics import MetricsRegistry


def make_client(metrics: MetricsRegistry) -> TestClient:
    app = FastAPI()
    app.include_router(create_metrics_router(metrics))
    return TestClient(app)


def test_serves_plain_text():
    response = make_client(MetricsRegistry()).get("/v1/metrics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")


def test_reflects_recorded_counters():
    metrics = MetricsRegistry()
    metrics.record_contribution(6)
    metrics.record_lookup()
    body = make_client(metrics).get("/v1/metrics").text
    assert "verdict_contribution_edges_total 6" in body
    assert "verdict_reputation_lookups_total 1" in body
