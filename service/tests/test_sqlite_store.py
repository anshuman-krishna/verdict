import sqlite3

import pytest

from verdict_service.graph.contribution_store import ContributionEdge
from verdict_service.graph.sqlite_store import (
    SqliteContributionEdgeStore,
    SqliteFlaggedHashStore,
    connect,
)


def edge(reviewer="r1", received_at=100.0, verified=True, signature=None) -> ContributionEdge:
    return ContributionEdge(
        reviewer_hash=reviewer,
        product_hash="p1",
        star_rating=5,
        week_bucket=2900,
        verified=verified,
        minhash_signature=signature if signature is not None else ["1", "2", "3"],
        received_at=received_at,
    )


@pytest.fixture
def connection(tmp_path):
    return connect(tmp_path / "verdict.db")


class TestContributionEdges:
    def test_round_trips_every_field(self, connection):
        store = SqliteContributionEdgeStore(connection)
        original = edge()
        store.add(original)
        assert store.list_since(0.0) == [original]

    @pytest.mark.parametrize("verified", [True, False, None])
    def test_keeps_the_three_verified_states_apart(self, connection, verified):
        store = SqliteContributionEdgeStore(connection)
        store.add(edge(verified=verified))
        assert store.list_since(0.0)[0].verified is verified

    def test_keeps_a_signature_as_a_list_of_strings(self, connection):
        store = SqliteContributionEdgeStore(connection)
        store.add(edge(signature=["10", "20"]))
        assert store.list_since(0.0)[0].minhash_signature == ["10", "20"]

    def test_list_since_is_inclusive_of_the_cutoff(self, connection):
        store = SqliteContributionEdgeStore(connection)
        store.add(edge(received_at=100.0))
        assert store.list_since(100.0) != []
        assert store.list_since(100.1) == []

    def test_returns_edges_oldest_first(self, connection):
        store = SqliteContributionEdgeStore(connection)
        store.add(edge(reviewer="late", received_at=200.0))
        store.add(edge(reviewer="early", received_at=100.0))
        assert [e.reviewer_hash for e in store.list_since(0.0)] == ["early", "late"]

    def test_prune_removes_only_what_is_older_and_reports_how_many(self, connection):
        store = SqliteContributionEdgeStore(connection)
        store.add(edge(received_at=100.0))
        store.add(edge(received_at=200.0))
        assert store.prune_older_than(150.0) == 1
        assert [e.received_at for e in store.list_since(0.0)] == [200.0]

    def test_prune_on_an_empty_store_removes_nothing(self, connection):
        assert SqliteContributionEdgeStore(connection).prune_older_than(150.0) == 0

    def test_keeps_two_edges_that_are_otherwise_identical(self, connection):
        store = SqliteContributionEdgeStore(connection)
        store.add(edge())
        store.add(edge())
        assert len(store.list_since(0.0)) == 2


class TestFlaggedHashes:
    def test_matches_a_prefix(self, connection):
        store = SqliteFlaggedHashStore(connection)
        store.add("abcd1111")
        store.add("abcd2222")
        store.add("bbbb3333")
        assert sorted(store.matches("abcd")) == ["abcd1111", "abcd2222"]

    def test_returns_nothing_for_a_prefix_with_no_hashes(self, connection):
        SqliteFlaggedHashStore(connection).add("abcd1111")
        assert SqliteFlaggedHashStore(connection).matches("ffff") == []

    def test_an_empty_prefix_returns_everything(self, connection):
        store = SqliteFlaggedHashStore(connection)
        store.add("abcd1111")
        assert store.matches("") == ["abcd1111"]

    def test_adding_the_same_hash_twice_records_it_once(self, connection):
        store = SqliteFlaggedHashStore(connection)
        store.add("abcd1111")
        store.add("abcd1111")
        assert store.matches("abcd") == ["abcd1111"]

    @pytest.mark.parametrize("prefix", ["%", "_", "a*", "a?", "a[b"])
    def test_a_pattern_character_is_matched_literally_not_as_a_wildcard(self, connection, prefix):
        store = SqliteFlaggedHashStore(connection)
        store.add("abcd1111")
        assert store.matches(prefix) == []

    def test_add_many_records_a_whole_batch(self, connection):
        store = SqliteFlaggedHashStore(connection)
        store.add_many(["abcd1111", "abcd2222"])
        assert sorted(store.matches("abcd")) == ["abcd1111", "abcd2222"]

    def test_add_many_adds_rather_than_replaces(self, connection):
        store = SqliteFlaggedHashStore(connection)
        store.add_many(["abcd1111"])
        store.add_many(["abcd2222"])
        assert sorted(store.matches("abcd")) == ["abcd1111", "abcd2222"]

    def test_add_many_tolerates_a_hash_it_already_has(self, connection):
        store = SqliteFlaggedHashStore(connection)
        store.add_many(["abcd1111", "abcd1111"])
        assert store.matches("abcd") == ["abcd1111"]

    def test_add_many_with_nothing_changes_nothing(self, connection):
        store = SqliteFlaggedHashStore(connection)
        store.add("abcd1111")
        store.add_many([])
        assert store.matches("abcd") == ["abcd1111"]


class TestSurvivingARestart:
    def test_edges_are_still_there_after_reopening_the_file(self, tmp_path):
        path = tmp_path / "verdict.db"
        SqliteContributionEdgeStore(connect(path)).add(edge(reviewer="persisted"))
        reopened = SqliteContributionEdgeStore(connect(path))
        assert [e.reviewer_hash for e in reopened.list_since(0.0)] == ["persisted"]

    def test_flagged_hashes_are_still_there_after_reopening_the_file(self, tmp_path):
        path = tmp_path / "verdict.db"
        SqliteFlaggedHashStore(connect(path)).add("abcd1111")
        assert SqliteFlaggedHashStore(connect(path)).matches("abcd") == ["abcd1111"]

    def test_opening_a_fresh_file_starts_empty_rather_than_failing(self, tmp_path):
        assert SqliteContributionEdgeStore(connect(tmp_path / "new.db")).list_since(0.0) == []

    def test_the_schema_is_applied_again_without_complaint(self, tmp_path):
        path = tmp_path / "verdict.db"
        connect(path)
        connect(path)
        assert SqliteFlaggedHashStore(connect(path)).matches("abcd") == []


def test_connect_uses_write_ahead_logging(tmp_path):
    database = connect(tmp_path / "verdict.db")
    assert database.read("PRAGMA journal_mode")[0][0] == "wal"


def test_the_edge_table_is_indexed_on_what_every_query_filters_by(tmp_path):
    indexes = connect(tmp_path / "verdict.db").read(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='contribution_edges'"
    )
    assert any("received_at" in row[0] for row in indexes)


def test_a_corrupt_file_fails_loudly_rather_than_starting_empty(tmp_path):
    path = tmp_path / "verdict.db"
    path.write_bytes(b"this is not a database")
    with pytest.raises(sqlite3.DatabaseError):
        connect(path)
