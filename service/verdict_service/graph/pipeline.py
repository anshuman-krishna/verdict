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

# SPEC.md section 5.6, steps 1 through 4, wired together for the first
# time: bipartite projection, the disparity filter backbone, leiden
# communities, and community scoring, ending in the one thing
# api/store.py's FlaggedHashStore actually needs. What is deliberately
# still missing is step 0: how reviewer_products and reviews (which
# products a reviewer reviewed, and the rating/date/category of each of
# their reviews) reach this process at all. That is the opt in ingestion
# path, PLAN.md week 9, and designing how reviewer identities get
# pseudonymised before the server ever sees a reviewer-product link is a
# genuine privacy protocol decision reserved for anshuman, not
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


# step 0, now that it has an answer: api/contribution.py is what
# reviewer_products and reviews above turn out to come from, and
# PRIVACY.md section 5's own pseudonymisation already decided how
# reviewer identity is protected before it gets here, so this is not a
# second privacy protocol decision, just wiring the one that already
# exists to the pipeline compute_flagged_hashes above did not yet reach.
#
# The one thing this genuinely cannot reuse from compute_flagged_hashes
# is its final reviewer_hash(reviewer_id, salt) step: a ContributionEdge's
# reviewer_hash already IS sha256(raw_reviewer_id + REPUTATION_SALT),
# computed client side, by the same reviewerHash extension/src/reputation/
# lookup.ts uses for a lookup query. This process never sees a raw
# reviewer_id to hash, only that value, so hashing it again here would
# produce sha256(sha256(raw_id + salt) + salt) instead, and no lookup
# request would ever match anything this flagged. Community membership,
# which is already exactly the hash a lookup checks, is added directly.
#
# category is deliberately absent: PRIVACY.md section 5 lists it under
# "never sent". community_scoring.py's category_incoherence already
# degrades a review with no category to "no evidence of incoherence"
# (0.0), the same way it degrades a review with only one distinct
# category; passing "" for every review reaches that same branch, not a
# crash and not a fabricated signal. minhash_signature is accepted and
# stored by api/contribution.py but nothing here consumes it yet: cross
# product near duplicate clustering server side, the natural use for it,
# is real infrastructure work (indexing a growing corpus of signatures)
# that this function does not attempt.
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
