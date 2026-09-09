import pytest

from verdict_service.api.store import InMemoryFlaggedHashStore
from verdict_service.graph.contribution_store import (
    ContributionEdge,
    InMemoryContributionEdgeStore,
)
from verdict_service.graph.recompute import recompute_flagged_hashes
from verdict_service.graph.sqlite_store import (
    SqliteContributionEdgeStore,
    SqliteFlaggedHashStore,
    connect,
)


@pytest.fixture(params=["memory", "sqlite"])
def stores(request, tmp_path):
    if request.param == "memory":
        return InMemoryContributionEdgeStore(), InMemoryFlaggedHashStore()
    connection = connect(tmp_path / "verdict.db")
    return SqliteContributionEdgeStore(connection), SqliteFlaggedHashStore(connection)


def edge(reviewer: str, received_at: float) -> ContributionEdge:
    return ContributionEdge(
        reviewer_hash=reviewer,
        product_hash="p1",
        star_rating=5,
        week_bucket=2900,
        verified=True,
        minhash_signature=["1"],
        received_at=received_at,
    )


class TestBothStoresAgree:
    def test_an_empty_edge_store_lists_nothing(self, stores):
        edges, _flagged = stores
        assert edges.list_since(0.0) == []

    def test_an_added_edge_comes_back_equal(self, stores):
        edges, _flagged = stores
        original = edge("r1", 100.0)
        edges.add(original)
        assert edges.list_since(0.0) == [original]

    def test_list_since_includes_the_cutoff_and_excludes_before_it(self, stores):
        edges, _flagged = stores
        edges.add(edge("old", 100.0))
        edges.add(edge("new", 300.0))
        assert {e.reviewer_hash for e in edges.list_since(300.0)} == {"new"}

    def test_prune_reports_how_many_it_removed(self, stores):
        edges, _flagged = stores
        edges.add(edge("old", 100.0))
        edges.add(edge("new", 300.0))
        assert edges.prune_older_than(200.0) == 1
        assert {e.reviewer_hash for e in edges.list_since(0.0)} == {"new"}

    def test_an_empty_flagged_store_matches_nothing(self, stores):
        _edges, flagged = stores
        assert flagged.matches("abcd") == []

    def test_a_flagged_hash_is_found_by_its_prefix(self, stores):
        _edges, flagged = stores
        flagged.add("abcd1111")
        assert flagged.matches("abcd") == ["abcd1111"]

    def test_a_prefix_that_matches_nothing_returns_nothing(self, stores):
        _edges, flagged = stores
        flagged.add("abcd1111")
        assert flagged.matches("ffff") == []

    def test_the_same_hash_added_twice_appears_once(self, stores):
        _edges, flagged = stores
        flagged.add("abcd1111")
        flagged.add("abcd1111")
        assert flagged.matches("abcd") == ["abcd1111"]

    def test_a_recompute_over_no_edges_flags_nobody(self, stores):
        edges, flagged = stores
        assert recompute_flagged_hashes(edges, flagged, now=lambda: 1000.0) == 0
        assert flagged.matches("") == []

    def test_a_recompute_runs_against_either_store_without_error(self, stores):
        edges, flagged = stores
        for index in range(20):
            edges.add(edge(f"r{index}", 1000.0))
        recompute_flagged_hashes(edges, flagged, now=lambda: 1000.0)
