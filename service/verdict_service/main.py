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

# where the two stores live. Unset means in memory, which is what tests and
# a bare `uvicorn verdict_service.main:app` get: a process that forgets
# everything on restart, correct for a throwaway run and useless for a
# deployment. Set it to a path on a volume and both stores persist there.
#
# opt in rather than a default path, because a service that silently starts
# writing a file somewhere is worse than one that plainly does not persist.
DATABASE_PATH = os.environ.get("VERDICT_DATABASE_PATH")

# graph/recompute.py is what turns contribution_edge_store's raw edges into
# flagged_hash_store (bipartite.py -> backbone.py -> community.py ->
# community_scoring.py, SPEC.md section 5.6), on the schedule started below.
if DATABASE_PATH:
    _connection = connect(DATABASE_PATH)
    flagged_hash_store: FlaggedHashStore = SqliteFlaggedHashStore(_connection)
    # PRIVACY.md section 5: where /v1/graph/contribute's accepted edges land.
    contribution_edge_store: ContributionEdgeStore = SqliteContributionEdgeStore(_connection)
else:
    flagged_hash_store = InMemoryFlaggedHashStore()
    contribution_edge_store = InMemoryContributionEdgeStore()

# community structure does not shift meaningfully within minutes of a handful of new edges landing,
# and this is a batch computation over the whole retained edge set, not a per request cost, so an
# hourly cadence keeps flagged_hash_store reasonably current without recomputing the graph far more
# often than the data underneath it actually changes.
RECOMPUTE_INTERVAL_SECONDS = 60 * 60


def _recompute() -> None:
    recompute_flagged_hashes(contribution_edge_store, flagged_hash_store)
    # PRIVACY.md section 8's 90 day retention, enforced here rather than by a separate schedule:
    # pruning right after a recompute guarantees every edge this deletes was already given a chance
    # to contribute to flagged_hash_store first, never dropped from consideration early.
    contribution_edge_store.prune_older_than(time.time() - RETENTION_SECONDS)


# in a thread, not on the loop. this is leiden community detection over the whole retained edge set,
# and run_periodically awaits a coroutine but calls a sync job inline, so on the loop it would hold
# every request for as long as the graph takes.
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
