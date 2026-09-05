from dataclasses import dataclass

from verdict_service.graph.bipartite import ReviewerEdge

# SPEC.md section 5.6 step 2: "extract the disparity filter backbone to
# keep only statistically significant edges." Serrano, Boguna and
# Vespignani, "Extracting the multiscale backbone of complex weighted
# networks" (2009). for a node of degree k whose edge weights normalize
# to shares p_1..p_k of its total strength, the null model is that those
# k shares came from randomly breaking a stick into k pieces. under that
# null, P(a given share >= p) is (1 - p)^(k - 1): a share far bigger than
# 1/k is unlikely to arise from random splitting, which is what makes an
# edge "significant" here, as distinct from bipartite.py's significance
# against a configuration model null.

DEFAULT_ALPHA = 0.05


def disparity_alpha(weight_share: float, degree: int) -> float:
    """P(a random stick-breaking share of a degree-k node exceeds weight_share)."""
    if degree <= 1:
        # nothing to compare a lone edge's share against, so it always
        # survives: this matches the original paper's treatment of
        # degree-1 nodes.
        return 0.0
    return (1 - weight_share) ** (degree - 1)


@dataclass
class BackboneEdge:
    reviewer_a: str
    reviewer_b: str
    weight: float


# an edge survives if it is disparity-significant from at least one of
# its two endpoints, the standard union rule for undirected backbones:
# a co-review relationship that dominates either reviewer's activity is
# worth keeping, even if it is diluted by the other reviewer's much
# larger activity.
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
