import asyncio
import logging
import os
import time
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from verdict_service.api.body_limit import MAX_REQUEST_BODY_BYTES, BodySizeLimit
from verdict_service.api.contribution import (
    DEFAULT_MAX_RETAINED_EDGES,
    CapacityGuard,
    create_contribution_router,
)
from verdict_service.api.health import create_health_router
from verdict_service.api.metrics import create_metrics_router
from verdict_service.api.reputation import create_reputation_router
from verdict_service.api.store import FlaggedHashStore, InMemoryFlaggedHashStore
from verdict_service.graph.backup import (
    BACKUP_INTERVAL_SECONDS,
    DEFAULT_RETAINED_BACKUPS,
    backup_is_due,
    default_backup_dir,
    newest_backup_time,
    run_backup,
)
from verdict_service.graph.contribution_store import (
    ContributionEdgeStore,
    InMemoryContributionEdgeStore,
)
from verdict_service.graph.database_lock import DatabaseLock
from verdict_service.graph.recompute import RETENTION_SECONDS, recompute_flagged_hashes
from verdict_service.graph.scheduler import run_periodically
from verdict_service.graph.sqlite_store import (
    Database,
    SqliteContributionEdgeStore,
    SqliteFlaggedHashStore,
    connect,
)
from verdict_service.health import HealthTracker
from verdict_service.logging_config import configure_logging
from verdict_service.metrics import MetricsRegistry

configure_logging()

logger = logging.getLogger("verdict_service.main")


DATABASE_PATH = os.environ.get("VERDICT_DATABASE_PATH")
STORE_KIND = "sqlite" if DATABASE_PATH else "memory"
BACKUP_CHECK_INTERVAL_SECONDS = 60 * 60
BACKUP_MAX_AGE_SECONDS = 2 * BACKUP_INTERVAL_SECONDS
BACKUP_DIR = default_backup_dir(Path(DATABASE_PATH)) if DATABASE_PATH else None
MAX_RETAINED_EDGES = int(os.environ.get("VERDICT_MAX_RETAINED_EDGES", DEFAULT_MAX_RETAINED_EDGES))

_connection: Database | None = None

if DATABASE_PATH:
    _connection = connect(DATABASE_PATH)
    flagged_hash_store: FlaggedHashStore = SqliteFlaggedHashStore(_connection)
    contribution_edge_store: ContributionEdgeStore = SqliteContributionEdgeStore(_connection)
else:
    flagged_hash_store = InMemoryFlaggedHashStore()
    contribution_edge_store = InMemoryContributionEdgeStore()

RECOMPUTE_INTERVAL_SECONDS = 60 * 60

health_tracker = HealthTracker()
metrics = MetricsRegistry()


def _prune(now: Callable[[], float] = time.time) -> None:
    try:
        contribution_edge_store.prune_older_than(now() - RETENTION_SECONDS)
    except Exception:
        metrics.record_prune_failure()
        logger.exception("pruning expired contribution edges failed")


def _recompute() -> None:
    try:
        flagged_count = recompute_flagged_hashes(contribution_edge_store, flagged_hash_store)
    except Exception as error:  # a recompute crash must still surface on /v1/health
        health_tracker.record_failure(error)
        raise
    finally:
        # retention must not depend on a recompute succeeding
        _prune()
    health_tracker.record_success(flagged_count)
    metrics.record_recompute(flagged_count)


async def _recompute_job() -> None:
    await asyncio.to_thread(_recompute)


def _backup(now: Callable[[], float] = time.time) -> None:
    assert _connection is not None and BACKUP_DIR is not None
    # checked hourly, so a crash looping container cannot rotate out good backups
    if not backup_is_due(BACKUP_DIR, now(), BACKUP_INTERVAL_SECONDS):
        return
    try:
        path = run_backup(_connection, BACKUP_DIR, now=now, retained=DEFAULT_RETAINED_BACKUPS)
    except Exception as error:
        metrics.record_backup_failure()
        health_tracker.record_backup_failure(error)
        raise
    metrics.record_backup()
    health_tracker.record_backup_success(str(path))


async def _backup_job() -> None:
    await asyncio.to_thread(_backup)


def _newest_backup_at() -> float | None:
    return newest_backup_time(BACKUP_DIR) if BACKUP_DIR is not None else None


def _gauges() -> dict[str, float]:
    newest = _newest_backup_at()
    return {} if newest is None else {"verdict_backup_newest_timestamp_seconds": newest}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    lock = DatabaseLock(Path(DATABASE_PATH)) if DATABASE_PATH else None
    if lock is not None:
        lock.acquire()
    tasks = [asyncio.create_task(run_periodically(RECOMPUTE_INTERVAL_SECONDS, _recompute_job))]
    if _connection is not None:
        tasks.append(
            asyncio.create_task(run_periodically(BACKUP_CHECK_INTERVAL_SECONDS, _backup_job))
        )
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if lock is not None:
            lock.release()


api = FastAPI(title="verdict-service", lifespan=lifespan)

capacity_guard = CapacityGuard(contribution_edge_store, MAX_RETAINED_EDGES)

api.include_router(create_reputation_router(flagged_hash_store, metrics))
api.include_router(
    create_contribution_router(contribution_edge_store, metrics=metrics, capacity=capacity_guard)
)
api.include_router(
    create_health_router(
        health_tracker,
        STORE_KIND,
        newest_backup_at=_newest_backup_at if BACKUP_DIR is not None else None,
        max_backup_age_seconds=BACKUP_MAX_AGE_SECONDS,
    )
)
api.include_router(create_metrics_router(metrics, gauges=_gauges))

app = BodySizeLimit(api, MAX_REQUEST_BODY_BYTES)
