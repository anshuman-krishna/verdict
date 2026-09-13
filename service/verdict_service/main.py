import asyncio
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from verdict_service.api.contribution import create_contribution_router
from verdict_service.api.health import create_health_router
from verdict_service.api.metrics import create_metrics_router
from verdict_service.api.reputation import create_reputation_router
from verdict_service.api.store import FlaggedHashStore, InMemoryFlaggedHashStore
from verdict_service.graph.backup import DEFAULT_RETAINED_BACKUPS, run_backup
from verdict_service.graph.contribution_store import (
    ContributionEdgeStore,
    InMemoryContributionEdgeStore,
)
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

DATABASE_PATH = os.environ.get("VERDICT_DATABASE_PATH")
STORE_KIND = "sqlite" if DATABASE_PATH else "memory"
BACKUP_INTERVAL_SECONDS = 24 * 60 * 60
BACKUP_DIR = Path(DATABASE_PATH).parent / "backups" if DATABASE_PATH else None

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


def _recompute() -> None:
    try:
        flagged_count = recompute_flagged_hashes(contribution_edge_store, flagged_hash_store)
        contribution_edge_store.prune_older_than(time.time() - RETENTION_SECONDS)
    except Exception as error:  # a recompute crash must still surface on /v1/health
        health_tracker.record_failure(error)
        raise
    health_tracker.record_success(flagged_count)
    metrics.record_recompute(flagged_count)


async def _recompute_job() -> None:
    await asyncio.to_thread(_recompute)


def _backup() -> None:
    assert _connection is not None and BACKUP_DIR is not None
    try:
        run_backup(_connection, BACKUP_DIR, retained=DEFAULT_RETAINED_BACKUPS)
    except Exception:
        metrics.record_backup_failure()
        raise
    metrics.record_backup()


async def _backup_job() -> None:
    await asyncio.to_thread(_backup)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    tasks = [asyncio.create_task(run_periodically(RECOMPUTE_INTERVAL_SECONDS, _recompute_job))]
    if _connection is not None:
        tasks.append(asyncio.create_task(run_periodically(BACKUP_INTERVAL_SECONDS, _backup_job)))
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()


app = FastAPI(title="verdict-service", lifespan=lifespan)

app.include_router(create_reputation_router(flagged_hash_store, metrics))
app.include_router(create_contribution_router(contribution_edge_store, metrics=metrics))
app.include_router(create_health_router(health_tracker, STORE_KIND))
app.include_router(create_metrics_router(metrics))
