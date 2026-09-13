from fastapi import FastAPI
from fastapi.testclient import TestClient

from verdict_service.api.metrics import create_metrics_router
from verdict_service.metrics import MetricsRegistry


def make_client(metrics: MetricsRegistry, gauges=None) -> TestClient:
    app = FastAPI()
    app.include_router(create_metrics_router(metrics, gauges=gauges))
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


def test_serves_gauges_computed_at_request_time():
    readings = iter([{"verdict_backup_newest_timestamp_seconds": 1.0}, {}])
    client = make_client(MetricsRegistry(), gauges=lambda: next(readings))
    first = client.get("/v1/metrics").text
    second = client.get("/v1/metrics").text
    assert "# TYPE verdict_backup_newest_timestamp_seconds gauge" in first
    assert "verdict_backup_newest_timestamp_seconds 1.0" in first
    assert "verdict_backup_newest_timestamp_seconds" not in second
