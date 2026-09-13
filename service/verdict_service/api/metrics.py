from collections.abc import Callable

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from verdict_service.metrics import MetricsRegistry


def create_metrics_router(
    metrics: MetricsRegistry, gauges: Callable[[], dict[str, float]] | None = None
) -> APIRouter:
    router = APIRouter()

    @router.get("/v1/metrics")
    def metrics_endpoint() -> PlainTextResponse:
        return PlainTextResponse(metrics.render_prometheus(gauges() if gauges else None))

    return router
