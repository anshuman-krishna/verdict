from verdict_service.graph.backbone import BackboneEdge
from verdict_service.graph.community import detect_communities


def clique(names: list[str], weight: float) -> list[BackboneEdge]:
    return [
        BackboneEdge(names[i], names[j], weight)
        for i in range(len(names))
        for j in range(i + 1, len(names))
    ]


def test_detect_communities_separates_two_dense_cliques_joined_by_one_weak_edge():
    group_a = ["a1", "a2", "a3", "a4", "a5"]
    group_b = ["b1", "b2", "b3", "b4", "b5"]
    edges = [
        *clique(group_a, weight=5.0),
        *clique(group_b, weight=5.0),
        BackboneEdge("a1", "b1", weight=0.01),
    ]

    communities = detect_communities(edges)

    assert len(communities) == 2
    sizes = sorted(len(community) for community in communities)
    assert sizes == [5, 5]
    community_sets = [set(community) for community in communities]
    assert set(group_a) in community_sets
    assert set(group_b) in community_sets


def test_detect_communities_is_empty_with_no_edges():
    assert detect_communities([]) == []


def test_detect_communities_groups_a_single_clique_into_one_community():
    edges = clique(["x1", "x2", "x3", "x4"], weight=1.0)
    communities = detect_communities(edges)
    assert len(communities) == 1
    assert set(communities[0]) == {"x1", "x2", "x3", "x4"}
