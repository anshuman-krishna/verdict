from dataclasses import dataclass
from math import comb, log10


def hypergeometric_overlap_pvalue(
    total_products: int, degree_i: int, degree_j: int, overlap: int
) -> float:
    """P(X >= overlap) for X ~ Hypergeometric(total_products, degree_i, degree_j)."""
    if overlap <= 0:
        return 1.0
    denominator = comb(total_products, degree_j)
    if denominator == 0:
        return 1.0
    upper = min(degree_i, degree_j)
    numerator = sum(
        comb(degree_i, x) * comb(total_products - degree_i, degree_j - x)
        for x in range(overlap, upper + 1)
    )
    return numerator / denominator


@dataclass
class ReviewerEdge:
    reviewer_a: str
    reviewer_b: str
    overlap: int
    p_value: float
    weight: float


DEFAULT_SIGNIFICANCE_LEVEL = 0.05
_MAX_WEIGHT = 300.0


def _weight(p_value: float) -> float:
    if p_value <= 0:
        return _MAX_WEIGHT
    return min(-log10(p_value), _MAX_WEIGHT)


def project_reviewer_graph(
    reviewer_products: dict[str, set[str]],
    significance_level: float = DEFAULT_SIGNIFICANCE_LEVEL,
) -> list[ReviewerEdge]:
    total_products = len(
        {product for products in reviewer_products.values() for product in products}
    )
    product_reviewers: dict[str, set[str]] = {}
    for reviewer, products in reviewer_products.items():
        for product in products:
            product_reviewers.setdefault(product, set()).add(reviewer)

    candidate_pairs: set[tuple[str, str]] = set()
    for reviewers in product_reviewers.values():
        ordered = sorted(reviewers)
        for i, reviewer_a in enumerate(ordered):
            for reviewer_b in ordered[i + 1 :]:
                candidate_pairs.add((reviewer_a, reviewer_b))

    edges: list[ReviewerEdge] = []
    for reviewer_a, reviewer_b in sorted(candidate_pairs):
        products_a = reviewer_products[reviewer_a]
        products_b = reviewer_products[reviewer_b]
        overlap = len(products_a & products_b)
        p_value = hypergeometric_overlap_pvalue(
            total_products, len(products_a), len(products_b), overlap
        )
        if p_value < significance_level:
            edges.append(
                ReviewerEdge(
                    reviewer_a=reviewer_a,
                    reviewer_b=reviewer_b,
                    overlap=overlap,
                    p_value=p_value,
                    weight=_weight(p_value),
                )
            )
    return edges
