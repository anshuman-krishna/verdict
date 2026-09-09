import time
from collections.abc import Callable

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from verdict_service.graph.contribution_store import ContributionEdge, ContributionEdgeStore

_HEX_DIGITS = set("0123456789abcdef")
_SHA256_HEX_LENGTH = 64
MAX_MINHASH_LENGTH = 128
MAX_EDGES_PER_BATCH = 500


class ContributionEdgeIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    reviewer_hash: str
    product_hash: str
    star_rating: int = Field(ge=1, le=5)
    week_bucket: int
    verified: bool | None = None
    minhash_signature: list[str] = Field(default_factory=list)

    @field_validator("reviewer_hash", "product_hash")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if len(value) != _SHA256_HEX_LENGTH or not set(value) <= _HEX_DIGITS:
            raise ValueError(
                f"must be a {_SHA256_HEX_LENGTH} character lowercase hex sha256 digest"
            )
        return value

    @field_validator("minhash_signature")
    @classmethod
    def validate_signature(cls, value: list[str]) -> list[str]:
        if len(value) > MAX_MINHASH_LENGTH:
            raise ValueError(f"minhash_signature must not exceed {MAX_MINHASH_LENGTH} entries")
        for entry in value:
            if not entry.isdigit():
                raise ValueError("minhash_signature entries must be decimal digit strings")
        return value


class ContributionBatch(BaseModel):
    edges: list[ContributionEdgeIn]

    @field_validator("edges")
    @classmethod
    def validate_batch_size(cls, value: list[ContributionEdgeIn]) -> list[ContributionEdgeIn]:
        if len(value) == 0:
            raise ValueError("edges must not be empty")
        if len(value) > MAX_EDGES_PER_BATCH:
            raise ValueError(f"edges must not exceed {MAX_EDGES_PER_BATCH} per batch")
        return value


class ContributionResponse(BaseModel):
    accepted: int


def create_contribution_router(
    store: ContributionEdgeStore, now: Callable[[], float] = time.time
) -> APIRouter:
    router = APIRouter()

    @router.post("/v1/graph/contribute", response_model=ContributionResponse)
    def contribute(body: ContributionBatch) -> ContributionResponse:
        received_at = now()
        for edge_in in body.edges:
            store.add(
                ContributionEdge(
                    reviewer_hash=edge_in.reviewer_hash,
                    product_hash=edge_in.product_hash,
                    star_rating=edge_in.star_rating,
                    week_bucket=edge_in.week_bucket,
                    verified=edge_in.verified,
                    minhash_signature=edge_in.minhash_signature,
                    received_at=received_at,
                )
            )
        return ContributionResponse(accepted=len(body.edges))

    return router
