from dataclasses import dataclass
from typing import Protocol

# PRIVACY.md section 5, "opt in contribution": what the ingestion endpoint
# (api/contribution.py) receives and stores before it is ever fed into
# the bipartite/backbone/community pipeline (graph/bipartite.py,
# backbone.py, community.py) that turns raw edges into the flagged
# buckets api/reputation.py answers lookups against. Wiring that
# pipeline to actually run against what accumulates here is the next
# join point, not something this file decides: same "the graph service
# that would populate this does not exist yet" gap api/store.py's own
# comment already names, one step further along.


@dataclass(frozen=True)
class ContributionEdge:
    reviewer_hash: str
    product_hash: str
    star_rating: int
    week_bucket: int
    verified: bool | None
    minhash_signature: list[str]
    # server assigned on receipt, never taken from the client: PRIVACY.md
    # section 8's 90 day retention on raw contributed edges has to be
    # measured against a clock this service controls, not one a client
    # could misreport to keep an edge alive past its real age.
    received_at: float


class ContributionEdgeStore(Protocol):
    def add(self, edge: ContributionEdge) -> None: ...

    def list_since(self, cutoff: float) -> list[ContributionEdge]:
        """every edge received at or after cutoff, for the pipeline to consume."""
        ...

    def prune_older_than(self, cutoff: float) -> int:
        """delete every edge received before cutoff; returns how many were removed."""
        ...


# a real deployment would persist this and run prune_older_than on a
# schedule against PRIVACY.md section 8's 90 day cutoff; this in memory
# version is what every deployment starts with today, same as
# api/store.py's InMemoryFlaggedHashStore.
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
