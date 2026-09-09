from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ContributionEdge:
    reviewer_hash: str
    product_hash: str
    star_rating: int
    week_bucket: int
    verified: bool | None
    minhash_signature: list[str]
    received_at: float


class ContributionEdgeStore(Protocol):
    def add(self, edge: ContributionEdge) -> None: ...

    def list_since(self, cutoff: float) -> list[ContributionEdge]:
        """every edge received at or after cutoff, for the pipeline to consume."""
        ...

    def prune_older_than(self, cutoff: float) -> int:
        """delete every edge received before cutoff; returns how many were removed."""
        ...


class InMemoryContributionEdgeStore:
    def __init__(self) -> None:
        self._edges: list[ContributionEdge] = []

    def add(self, edge: ContributionEdge) -> None:
        self._edges.append(edge)

    def list_since(self, cutoff: float) -> list[ContributionEdge]:
        return [edge for edge in self._edges if edge.received_at >= cutoff]

    def prune_older_than(self, cutoff: float) -> int:
        kept = [edge for edge in self._edges if edge.received_at >= cutoff]
        pruned = len(self._edges) - len(kept)
        self._edges = kept
        return pruned
