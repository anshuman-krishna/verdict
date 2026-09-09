import igraph as ig
import leidenalg

from verdict_service.graph.backbone import BackboneEdge


def detect_communities(edges: list[BackboneEdge]) -> list[list[str]]:
    """groups reviewer ids into communities from the disparity filter backbone.

    returns one list of reviewer ids per community, largest first. a reviewer
    with no surviving edge does not appear in any community, since a lone
    node forms a "community" of one that step 4's scoring cannot say
    anything about.
    """
    if not edges:
        return []

    reviewer_ids = sorted({node for edge in edges for node in (edge.reviewer_a, edge.reviewer_b)})
    index_of = {reviewer_id: index for index, reviewer_id in enumerate(reviewer_ids)}

    graph = ig.Graph()
    graph.add_vertices(len(reviewer_ids))
    graph.add_edges([(index_of[edge.reviewer_a], index_of[edge.reviewer_b]) for edge in edges])
    graph.es["weight"] = [edge.weight for edge in edges]

    partition = leidenalg.find_partition(
        graph, leidenalg.ModularityVertexPartition, weights="weight"
    )

    communities = [[reviewer_ids[index] for index in community] for community in partition]
    return sorted(communities, key=len, reverse=True)
