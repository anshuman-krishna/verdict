from fastapi import APIRouter
from pydantic import BaseModel, field_validator

from verdict_service.api.store import FlaggedHashStore
from verdict_service.metrics import MetricsRegistry

PREFIX_LENGTH = 4
BUCKET_COUNT = 32
_HEX_DIGITS = set("0123456789abcdef")


class ReputationLookupRequest(BaseModel):
    prefixes: list[str]

    @field_validator("prefixes")
    @classmethod
    def validate_prefixes(cls, value: list[str]) -> list[str]:
        if len(value) != BUCKET_COUNT:
            raise ValueError(f"prefixes must contain exactly {BUCKET_COUNT} entries")
        for prefix in value:
            if len(prefix) != PREFIX_LENGTH or not set(prefix) <= _HEX_DIGITS:
                raise ValueError(
                    f"prefix must be {PREFIX_LENGTH} lowercase hex characters: {prefix!r}"
                )
        return value


class ReputationLookupResponse(BaseModel):
    matches: dict[str, list[str]]


def create_reputation_router(
    store: FlaggedHashStore, metrics: MetricsRegistry | None = None
) -> APIRouter:
    router = APIRouter()

    @router.post("/v1/reputation/lookup", response_model=ReputationLookupResponse)
    def lookup(body: ReputationLookupRequest) -> ReputationLookupResponse:
        if metrics is not None:
            metrics.record_lookup()
        return ReputationLookupResponse(
            matches={prefix: store.matches(prefix) for prefix in body.prefixes}
        )

    return router
