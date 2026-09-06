import asyncio
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI

from verdict_service.api.contribution import create_contribution_router
from verdict_service.api.reputation import create_reputation_router
from verdict_service.api.store import InMemoryFlaggedHashStore
from verdict_service.graph.contribution_store import InMemoryContributionEdgeStore
from verdict_service.graph.recompute import RETENTION_SECONDS, recompute_flagged_hashes
from verdict_service.graph.scheduler import run_periodically
from verdict_service.logging_config import configure_logging

configure_logging()

# module level so a deployment's flagged set survives across requests
# within one process. graph/recompute.py is what turns
# contribution_edge_store's raw edges into this (bipartite.py ->
# backbone.py -> community.py -> community_scoring.py, SPEC.md
# section 5.6), on the schedule started below.
flagged_hash_store = InMemoryFlaggedHashStore()

# PRIVACY.md section 5: where /v1/graph/contribute's accepted edges land.
contribution_edge_store = InMemoryContributionEdgeStore()

# community structure does not shift meaningfully within minutes of a
# handful of new edges landing, and this is a batch computation over the
# whole retained edge set, not a per request cost, so an hourly cadence
# keeps flagged_hash_store reasonably current without recomputing the
# graph far more often than the data underneath it actually changes.
RECOMPUTE_INTERVAL_SECONDS = 60 * 60


def _recompute_job() -> None:
    recompute_flagged_hashes(contribution_edge_store, flagged_hash_store)
    # PRIVACY.md section 8's 90 day retention, enforced here rather than
    # by a separate schedule: pruning right after a recompute guarantees
    # every edge this deletes was already given a chance to contribute to
    # flagged_hash_store first, never dropped from consideration early.
    contribution_edge_store.prune_older_than(time.time() - RETENTION_SECONDS)


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
