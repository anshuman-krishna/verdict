import asyncio
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI

from verdict_service.api.contribution import create_contribution_router
from verdict_service.api.reputation import create_reputation_router
from verdict_service.api.store import FlaggedHashStore, InMemoryFlaggedHashStore
from verdict_service.graph.contribution_store import (
    ContributionEdgeStore,
    InMemoryContributionEdgeStore,
)
from verdict_service.graph.recompute import RETENTION_SECONDS, recompute_flagged_hashes
from verdict_service.graph.scheduler import run_periodically
from verdict_service.graph.sqlite_store import (
    SqliteContributionEdgeStore,
    SqliteFlaggedHashStore,
    connect,
)
from verdict_service.logging_config import configure_logging

configure_logging()

DATABASE_PATH = os.environ.get("VERDICT_DATABASE_PATH")

if DATABASE_PATH:
    _connection = connect(DATABASE_PATH)
    flagged_hash_store: FlaggedHashStore = SqliteFlaggedHashStore(_connection)
    contribution_edge_store: ContributionEdgeStore = SqliteContributionEdgeStore(_connection)
else:
    flagged_hash_store = InMemoryFlaggedHashStore()
    contribution_edge_store = InMemoryContributionEdgeStore()

RECOMPUTE_INTERVAL_SECONDS = 60 * 60


def _recompute() -> None:
    recompute_flagged_hashes(contribution_edge_store, flagged_hash_store)
    contribution_edge_store.prune_older_than(time.time() - RETENTION_SECONDS)


async def _recompute_job() -> None:
    await asyncio.to_thread(_recompute)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(run_periodically(RECOMPUTE_INTERVAL_SECONDS, _recompute_job))
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="verdict-service", lifespan=lifespan)

app.include_router(create_reputation_router(flagged_hash_store))
app.include_router(create_contribution_router(contribution_edge_store))
