from dataclasses import dataclass

from verdict_service.graph.bipartite import ReviewerEdge

DEFAULT_ALPHA = 0.05


def disparity_alpha(weight_share: float, degree: int) -> float:
    """P(a random stick-breaking share of a degree-k node exceeds weight_share)."""
    if degree <= 1:
        return 0.0
    return (1 - weight_share) ** (degree - 1)


@dataclass
class BackboneEdge:
    reviewer_a: str
    reviewer_b: str
    weight: float


def disparity_filter(edges: list[ReviewerEdge], alpha: float = DEFAULT_ALPHA) -> list[BackboneEdge]:
    neighbor_weights: dict[str, list[float]] = {}
    for edge in edges:
        neighbor_weights.setdefault(edge.reviewer_a, []).append(edge.weight)
        neighbor_weights.setdefault(edge.reviewer_b, []).append(edge.weight)

    def significant_from(node: str, weight: float) -> bool:
        weights = neighbor_weights[node]
        degree = len(weights)
        strength = sum(weights)
        if strength <= 0:
            return False
        share = weight / strength
        return disparity_alpha(share, degree) < alpha

    return [
        BackboneEdge(edge.reviewer_a, edge.reviewer_b, edge.weight)
        for edge in edges
        if significant_from(edge.reviewer_a, edge.weight)
        or significant_from(edge.reviewer_b, edge.weight)
    ]
