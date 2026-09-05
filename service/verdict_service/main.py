from fastapi import FastAPI

from verdict_service.api.reputation import create_reputation_router
from verdict_service.api.store import InMemoryFlaggedHashStore

app = FastAPI(title="verdict-service")

# module level so a deployment's flagged set survives across requests
# within one process. the opt in ingestion path that writes to it
# (SPEC.md section 5.6, PLAN.md week 9) is not built yet.
flagged_hash_store = InMemoryFlaggedHashStore()

app.include_router(create_reputation_router(flagged_hash_store))
