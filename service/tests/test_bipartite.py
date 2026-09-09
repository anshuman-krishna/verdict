from math import log10

import pytest

from verdict_service.graph.bipartite import (
    hypergeometric_overlap_pvalue,
    project_reviewer_graph,
)


def test_hypergeometric_pvalue_hand_checked_full_overlap():
    assert hypergeometric_overlap_pvalue(
        total_products=10, degree_i=3, degree_j=3, overlap=3
    ) == pytest.approx(1 / 120)


def test_hypergeometric_pvalue_hand_checked_partial_overlap():
    assert hypergeometric_overlap_pvalue(
        total_products=10, degree_i=3, degree_j=3, overlap=1
    ) == pytest.approx(1 - 35 / 120)


def test_hypergeometric_pvalue_is_one_with_no_overlap():
    assert (
        hypergeometric_overlap_pvalue(total_products=10, degree_i=3, degree_j=3, overlap=0) == 1.0
    )


def test_project_reviewer_graph_keeps_only_the_significant_pair():
    reviewer_products = {
        "a": {"p1", "p2", "p3"},
        "b": {"p1", "p2", "p3"},
        "c": {"p1", "p4", "p7"},
        "d": {"p5", "p6", "p8", "p9", "p10"},
    }

    edges = project_reviewer_graph(reviewer_products, significance_level=0.05)

    assert [(e.reviewer_a, e.reviewer_b) for e in edges] == [("a", "b")]
    edge = edges[0]
    assert edge.overlap == 3
    assert edge.p_value == pytest.approx(1 / 120)
    assert edge.weight == pytest.approx(-log10(1 / 120))


def test_project_reviewer_graph_is_empty_with_no_shared_products():
    reviewer_products = {"a": {"p1"}, "b": {"p2"}}
    assert project_reviewer_graph(reviewer_products) == []
