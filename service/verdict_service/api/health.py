from fastapi import APIRouter
from pydantic import BaseModel

from verdict_service.health import HealthTracker


class RecomputeStatus(BaseModel):
    lastCompletedAt: float | None
    lastFlaggedCount: int | None
    lastError: str | None


class HealthResponse(BaseModel):
    status: str
    store: str
    recompute: RecomputeStatus | None


def create_health_router(tracker: HealthTracker, store: str) -> APIRouter:
    router = APIRouter()

    @router.get("/v1/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        last = tracker.last
        recompute = (
            RecomputeStatus(
                lastCompletedAt=last.completed_at,
                lastFlaggedCount=last.flagged_count,
                lastError=last.error,
            )
            if last
            else None
        )
        degraded = last is not None and last.error is not None
        return HealthResponse(
            status="degraded" if degraded else "ok", store=store, recompute=recompute
        )

    return router
