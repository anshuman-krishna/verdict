from verdict_service.graph.backbone import DEFAULT_ALPHA, disparity_filter
from verdict_service.graph.bipartite import DEFAULT_SIGNIFICANCE_LEVEL, project_reviewer_graph
from verdict_service.graph.community import detect_communities
from verdict_service.graph.community_scoring import (
    DEFAULT_FLAG_THRESHOLD,
    ReviewRecord,
    score_community,
)
from verdict_service.graph.hashing import reviewer_hash

# SPEC.md section 5.6, steps 1 through 4, wired together for the first
# time: bipartite projection, the disparity filter backbone, leiden
# communities, and community scoring, ending in the one thing
# api/store.py's FlaggedHashStore actually needs. What is deliberately
# still missing is step 0: how reviewer_products and reviews (which
# products a reviewer reviewed, and the rating/date/category of each of
# their reviews) reach this process at all. That is the opt in ingestion
# path, PLAN.md week 9, and designing how reviewer identities get
# pseudonymised before the server ever sees a reviewer-product link is a
# genuine privacy protocol decision CLAUDE.md reserves for anshuman, not
# a default this function should quietly pick. This function takes that
# data as already given, from wherever it ends up coming from.


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
