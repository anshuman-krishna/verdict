"""Contribution edges arrive from anyone, with no client identity attached.

PRIVACY.md section 5 forbids a client identifier, and the published proxy
configuration strips the client address headers, so nothing here can be per
submitter. The defences are structural: repetition buys no weight, submitters
who disagree about a review cancel rather than outvote each other, and no single
reviewer or product can be made into a hub by volume alone.
"""

from collections import defaultdict
from dataclasses import dataclass

from verdict_service.graph.contribution_store import ContributionEdge

# a real reviewer with more than this is already an outlier, and past it the
# marginal edge carries no information and a great deal of leverage
MAX_PRODUCTS_PER_REVIEWER = 500
MAX_REVIEWERS_PER_PRODUCT = 5000

EdgeIdentity = tuple[str, str]
EdgeClaim = tuple[int, int, bool | None]


def edge_identity(edge: ContributionEdge) -> EdgeIdentity:
    """which review this is: one reviewer, one product."""
    return (edge.reviewer_hash, edge.product_hash)


def edge_claim(edge: ContributionEdge) -> EdgeClaim:
    """what the submitter asserts about that review."""
    return (edge.star_rating, edge.week_bucket, edge.verified)


@dataclass(frozen=True)
class SanitisedContributions:
    edges: list[ContributionEdge]
    duplicates: int
    conflicts: int
    over_degree: int

    @property
    def accepted(self) -> int:
        return len(self.edges)


def _earliest(edges: list[ContributionEdge]) -> ContributionEdge:
    return min(edges, key=lambda edge: (edge.received_at, edge_claim(edge)))


def _within_degree_caps(
    edges: list[ContributionEdge],
    max_products_per_reviewer: int,
    max_reviewers_per_product: int,
) -> tuple[list[ContributionEdge], int]:
    # earliest first, so a later flood cannot displace what was already there
    ordered = sorted(edges, key=lambda edge: (edge.received_at, edge_identity(edge)))
    per_reviewer: defaultdict[str, int] = defaultdict(int)
    per_product: defaultdict[str, int] = defaultdict(int)
    kept: list[ContributionEdge] = []
    dropped = 0
    for edge in ordered:
        if (
            per_reviewer[edge.reviewer_hash] >= max_products_per_reviewer
            or per_product[edge.product_hash] >= max_reviewers_per_product
        ):
            dropped += 1
            continue
        per_reviewer[edge.reviewer_hash] += 1
        per_product[edge.product_hash] += 1
        kept.append(edge)
    return kept, dropped


def sanitise_contributions(
    edges: list[ContributionEdge],
    max_products_per_reviewer: int = MAX_PRODUCTS_PER_REVIEWER,
    max_reviewers_per_product: int = MAX_REVIEWERS_PER_PRODUCT,
) -> SanitisedContributions:
    by_identity: defaultdict[EdgeIdentity, list[ContributionEdge]] = defaultdict(list)
    for edge in edges:
        by_identity[edge_identity(edge)].append(edge)

    unique: list[ContributionEdge] = []
    duplicates = 0
    conflicts = 0
    for submissions in by_identity.values():
        claims = {edge_claim(edge) for edge in submissions}
        if len(claims) > 1:
            # at least one submitter is wrong about this review and there is no way
            # to tell which, so it is dropped rather than decided by who sent more
            conflicts += len(submissions)
            continue
        duplicates += len(submissions) - 1
        unique.append(_earliest(submissions))

    kept, over_degree = _within_degree_caps(
        unique, max_products_per_reviewer, max_reviewers_per_product
    )
    return SanitisedContributions(
        edges=kept,
        duplicates=duplicates,
        conflicts=conflicts,
        over_degree=over_degree,
    )
