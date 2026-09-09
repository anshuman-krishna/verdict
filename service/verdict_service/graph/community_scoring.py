import math
from collections import Counter
from dataclasses import dataclass

from verdict_service.graph.backbone import BackboneEdge


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


def rating_homogeneity(ratings: list[float]) -> float:
    if len(ratings) < 2:
        return 0.0
    mean = sum(ratings) / len(ratings)
    variance = sum((r - mean) ** 2 for r in ratings) / len(ratings)
    stddev = math.sqrt(variance)
    return max(0.0, 1 - stddev / 2)


_TEMPORAL_REFERENCE_SPAN_DAYS = 365


def temporal_clustering(day_indices: list[int]) -> float:
    if len(day_indices) < 2:
        return 0.0
    spread = max(day_indices) - min(day_indices)
    return max(0.0, 1 - spread / _TEMPORAL_REFERENCE_SPAN_DAYS)


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
