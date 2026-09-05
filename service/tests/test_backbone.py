import pytest

from verdict_service.graph.backbone import disparity_alpha, disparity_filter
from verdict_service.graph.bipartite import ReviewerEdge


def edge(a: str, b: str, weight: float) -> ReviewerEdge:
    return ReviewerEdge(reviewer_a=a, reviewer_b=b, overlap=1, p_value=0.01, weight=weight)


def test_disparity_alpha_hand_checked():
    # (1 - 0.8)^(3-1) = 0.2^2 = 0.04
    assert disparity_alpha(0.8, 3) == pytest.approx(0.04)
    # (1 - 0.1)^(3-1) = 0.9^2 = 0.81
    assert disparity_alpha(0.1, 3) == pytest.approx(0.81)


def test_disparity_alpha_is_always_significant_at_degree_one():
    assert disparity_alpha(0.0001, 1) == 0.0
    assert disparity_alpha(1.0, 1) == 0.0


def test_disparity_filter_keeps_a_dominant_edge_and_drops_a_diluted_one():
    # A has degree 3, strength 10: a-b carries share 0.8, alpha = 0.2^2 =
    # 0.04, significant. a-c and a-d each carry share 0.1, alpha = 0.9^2
    # = 0.81, not significant.
    # B has degree 5, strength 12: b-a carries share 0.667, alpha =
    # 0.333^4 ~= 0.0123, significant too, so a-b survives from both sides.
    # C has degree 3, strength 3 (c-a, c-x, c-y all weight 1): every
    # share is 0.333, alpha = 0.667^2 ~= 0.444, not significant from c's
    # side either, so a-c is dropped: neither endpoint finds it dominant.
    # a-d survives anyway, because d's only edge is a-d (degree 1 always
    # survives), and b's and c's other leaves (e, f, g, h, x, y) are
    # degree 1 for the same reason.
    edges = [
        edge("a", "b", 8),
        edge("a", "c", 1),
        edge("a", "d", 1),
        edge("b", "e", 1),
        edge("b", "f", 1),
        edge("b", "g", 1),
        edge("b", "h", 1),
        edge("c", "x", 1),
        edge("c", "y", 1),
    ]

    backbone = disparity_filter(edges, alpha=0.05)
    kept = {(e.reviewer_a, e.reviewer_b) for e in backbone}

    assert ("a", "b") in kept
    assert ("a", "c") not in kept
    assert ("a", "d") in kept
    assert ("b", "e") in kept
    assert ("c", "x") in kept


def test_disparity_filter_is_empty_with_no_edges():
    assert disparity_filter([]) == []
