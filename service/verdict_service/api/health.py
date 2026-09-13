import time
from collections.abc import Callable

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
    newestAt: float | None
    stale: bool


class HealthResponse(BaseModel):
    status: str
    store: str
    recompute: RecomputeStatus | None
    backup: BackupStatus | None


def create_health_router(
    tracker: HealthTracker,
    store: str,
    newest_backup_at: Callable[[], float | None] | None = None,
    max_backup_age_seconds: float = 2 * 24 * 60 * 60,
    now: Callable[[], float] = time.time,
) -> APIRouter:
    router = APIRouter()

    def backup_status() -> BackupStatus | None:
        last = tracker.last_backup
        if last is None and newest_backup_at is None:
            return None
        if newest_backup_at is not None:
            newest = newest_backup_at()
        elif last is not None and last.error is None:
            newest = last.completed_at
        else:
            newest = None
        if newest is None:
            stale = last is not None
        else:
            stale = now() - newest > max_backup_age_seconds
        return BackupStatus(
            lastCompletedAt=last.completed_at if last else None,
            lastPath=last.path if last else None,
            lastError=last.error if last else None,
            newestAt=newest,
            stale=stale,
        )

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
        backup = backup_status()
        degraded = (
            (last is not None and last.error is not None)
            or (backup is not None and backup.lastError is not None)
            or (backup is not None and backup.stale)
        )
        return HealthResponse(
            status="degraded" if degraded else "ok",
            store=store,
            recompute=recompute,
            backup=backup,
        )

    return router
