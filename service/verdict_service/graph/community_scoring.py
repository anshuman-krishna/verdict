import math
from collections import Counter
from dataclasses import dataclass

from verdict_service.graph.backbone import BackboneEdge

# SPEC.md section 5.6 step 4: "score each community on internal density,
# rating homogeneity, temporal clustering, and category incoherence."
# Unlike steps 1 through 3 (bipartite.py, backbone.py, community.py), none
# of which had a free parameter to choose, this step is anshuman's to
# define: what makes a community "high scoring" is exactly the kind of
# signal threshold division of work reserves for anshuman. The four
# component functions below compute well defined statistics with no
# judgement call in them; combining them into one score and the flagging
# threshold are proposals, the same spirit as evidence.ts's strength cut
# points and band.ts's quintiles on the extension side, offered so the
# pipeline has something to run end to end rather than stopping here.


@dataclass
class ReviewRecord:
    reviewer_id: str
    rating: float
    day_index: int
    category: str


def graph_density(community: list[str], edges: list[BackboneEdge]) -> float:
    """the share of possible edges within the community that actually exist."""
    n = len(community)
    if n < 2:
        return 0.0
    members = set(community)
    internal_edges = sum(
        1 for edge in edges if edge.reviewer_a in members and edge.reviewer_b in members
    )
    max_edges = n * (n - 1) / 2
    return internal_edges / max_edges


# 1 minus the population standard deviation, normalised by the largest
# possible spread on a 1 to 5 star scale (an even split between 1 and 5,
# stddev 2): tight agreement scores near 1, a spread across the whole
# scale scores near 0. Fewer than two ratings gives no evidence either
# way, and returns 0 rather than a default of "homogeneous", the same
# "none is not the same as zero" reasoning evidence.ts's rows use.
def rating_homogeneity(ratings: list[float]) -> float:
    if len(ratings) < 2:
        return 0.0
    mean = sum(ratings) / len(ratings)
    variance = sum((r - mean) ** 2 for r in ratings) / len(ratings)
    stddev = math.sqrt(variance)
    return max(0.0, 1 - stddev / 2)


# 1 minus the observed date range normalised against a year: reviews all
# landing on the same day score 1, reviews spread across a year or more
# score near 0. A year is a round, defensible reference span for "spread
# out", not a fitted or measured constant.
_TEMPORAL_REFERENCE_SPAN_DAYS = 365


def temporal_clustering(day_indices: list[int]) -> float:
    if len(day_indices) < 2:
        return 0.0
    spread = max(day_indices) - min(day_indices)
    return max(0.0, 1 - spread / _TEMPORAL_REFERENCE_SPAN_DAYS)


# normalised shannon entropy of the category labels: all one category is
# 0 (perfectly coherent), spread evenly across many categories approaches
# 1. Needs at least two distinct categories to normalise against; one
# category, like too few ratings above, is not incoherence, it is no
# evidence of any.
def category_incoherence(categories: list[str]) -> float:
    if not categories:
        return 0.0
    counts = Counter(categories)
    if len(counts) < 2:
        return 0.0
    total = len(categories)
    entropy = -sum((count / total) * math.log2(count / total) for count in counts.values())
    return entropy / math.log2(len(counts))


DEFAULT_FLAG_THRESHOLD = 0.6


@dataclass
class CommunityScore:
    density: float
    rating_homogeneity: float
    temporal_clustering: float
    category_incoherence: float
    combined: float
    flagged: bool


# the combined score is an unweighted mean of the four components: a
# proposal, not a fitted or ratified weighting.
def score_community(
    community: list[str],
    edges: list[BackboneEdge],
    reviews: list[ReviewRecord],
    flag_threshold: float = DEFAULT_FLAG_THRESHOLD,
) -> CommunityScore:
    members = set(community)
    member_reviews = [review for review in reviews if review.reviewer_id in members]

    density = graph_density(community, edges)
    homogeneity = rating_homogeneity([review.rating for review in member_reviews])
    clustering = temporal_clustering([review.day_index for review in member_reviews])
    incoherence = category_incoherence([review.category for review in member_reviews])
    combined = (density + homogeneity + clustering + incoherence) / 4

    return CommunityScore(
        density=density,
        rating_homogeneity=homogeneity,
        temporal_clustering=clustering,
        category_incoherence=incoherence,
        combined=combined,
        flagged=combined >= flag_threshold,
    )
