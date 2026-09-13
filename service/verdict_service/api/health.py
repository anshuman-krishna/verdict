from fastapi import APIRouter
from pydantic import BaseModel

from verdict_service.health import HealthTracker


class RecomputeStatus(BaseModel):
    lastCompletedAt: float | None
    lastFlaggedCount: int | None
    lastError: str | None


class BackupStatus(BaseModel):
    lastCompletedAt: float | None
    lastPath: str | None
    lastError: str | None


class HealthResponse(BaseModel):
    status: str
    store: str
    recompute: RecomputeStatus | None
    backup: BackupStatus | None


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
        last_backup = tracker.last_backup
        backup = (
            BackupStatus(
                lastCompletedAt=last_backup.completed_at,
                lastPath=last_backup.path,
                lastError=last_backup.error,
            )
            if last_backup
            else None
        )
        degraded = (last is not None and last.error is not None) or (
            last_backup is not None and last_backup.error is not None
        )
        return HealthResponse(
            status="degraded" if degraded else "ok",
            store=store,
            recompute=recompute,
            backup=backup,
        )

    return router
