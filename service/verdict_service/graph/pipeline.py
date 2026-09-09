from verdict_service.graph.backbone import DEFAULT_ALPHA, disparity_filter
from verdict_service.graph.bipartite import DEFAULT_SIGNIFICANCE_LEVEL, project_reviewer_graph
from verdict_service.graph.community import detect_communities
from verdict_service.graph.community_scoring import (
    DEFAULT_FLAG_THRESHOLD,
    ReviewRecord,
    score_community,
)
from verdict_service.graph.contribution_store import ContributionEdge
from verdict_service.graph.hashing import reviewer_hash


def compute_flagged_hashes(
    reviewer_products: dict[str, set[str]],
    reviews: list[ReviewRecord],
    salt: str,
    significance_level: float = DEFAULT_SIGNIFICANCE_LEVEL,
    alpha: float = DEFAULT_ALPHA,
    flag_threshold: float = DEFAULT_FLAG_THRESHOLD,
) -> set[str]:
    edges = project_reviewer_graph(reviewer_products, significance_level)
    backbone = disparity_filter(edges, alpha)
    communities = detect_communities(backbone)

    flagged_hashes: set[str] = set()
    for community in communities:
        score = score_community(community, backbone, reviews, flag_threshold)
        if score.flagged:
            for reviewer_id in community:
                flagged_hashes.add(reviewer_hash(reviewer_id, salt))
    return flagged_hashes


_DAYS_PER_WEEK = 7


def compute_flagged_hashes_from_contributions(
    edges: list[ContributionEdge],
    significance_level: float = DEFAULT_SIGNIFICANCE_LEVEL,
    alpha: float = DEFAULT_ALPHA,
    flag_threshold: float = DEFAULT_FLAG_THRESHOLD,
) -> set[str]:
    reviewer_products: dict[str, set[str]] = {}
    reviews: list[ReviewRecord] = []
    for edge in edges:
        reviewer_products.setdefault(edge.reviewer_hash, set()).add(edge.product_hash)
        reviews.append(
            ReviewRecord(
                reviewer_id=edge.reviewer_hash,
                rating=edge.star_rating,
                day_index=edge.week_bucket * _DAYS_PER_WEEK,
                category="",
            )
        )

    reviewer_edges = project_reviewer_graph(reviewer_products, significance_level)
    backbone = disparity_filter(reviewer_edges, alpha)
    communities = detect_communities(backbone)

    flagged_hashes: set[str] = set()
    for community in communities:
        score = score_community(community, backbone, reviews, flag_threshold)
        if score.flagged:
            flagged_hashes.update(community)
    return flagged_hashes
