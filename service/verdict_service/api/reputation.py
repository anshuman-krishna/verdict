from fastapi import APIRouter
from pydantic import BaseModel, field_validator

from verdict_service.api.store import FlaggedHashStore

# SPEC.md section 8, the k anonymous reputation lookup protocol. the
# extension computes sha256(reviewer_id + salt) locally, sends only the
# first PREFIX_LENGTH hex characters of each hash, deduplicated and
# padded with random prefixes to exactly BUCKET_COUNT, and matches the
# response against its own hashes locally. this endpoint never receives
# a reviewer id, a product identifier, or a real hash, only prefixes, and
# it never has any way to tell which of the BUCKET_COUNT prefixes in a
# given request were real.

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
    # every prefix the caller sent, mapped to whatever this store has
    # flagged under it. always all BUCKET_COUNT keys, real or padding
    # alike, so the response shape itself never signals which were real.
    matches: dict[str, list[str]]


# a plain function, not a class with request state, because this handler
# reads nothing from the request except the validated body: no cookie, no
# header, no client address. that is enforced by never referencing
# `request` at all, not by a filter that could be forgotten later.
def create_reputation_router(store: FlaggedHashStore) -> APIRouter:
    router = APIRouter()

    @router.post("/v1/reputation/lookup", response_model=ReputationLookupResponse)
    def lookup(body: ReputationLookupRequest) -> ReputationLookupResponse:
        return ReputationLookupResponse(
            matches={prefix: store.matches(prefix) for prefix in body.prefixes}
        )

    return router
