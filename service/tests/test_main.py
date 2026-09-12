import asyncio
import hashlib

from fastapi.testclient import TestClient


def full_hash(label: str) -> str:
    return hashlib.sha256(label.encode()).hexdigest()


def contribution_edge(
    reviewer: str, product: str, star_rating: int = 5, week_bucket: int = 10
) -> dict:
    return {
        "reviewer_hash": full_hash(reviewer),
        "product_hash": full_hash(product),
        "star_rating": star_rating,
        "week_bucket": week_bucket,
        "verified": True,
        "minhash_signature": [],
    }


def test_lifespan_starts_and_stops_without_error():
    from verdict_service.main import app

    with TestClient(app):
        pass


def test_health_reflects_a_completed_recompute():
    from verdict_service.main import _recompute_job, app, contribution_edge_store, health_tracker

    contribution_edge_store._edges.clear()

    with TestClient(app) as client:
        asyncio.run(_recompute_job())
        body = client.get("/v1/health").json()

    assert body["status"] == "ok"
    assert body["store"] == "memory"
    assert body["recompute"]["lastCompletedAt"] == health_tracker.last.completed_at


def test_metrics_count_a_contribution_a_lookup_and_a_recompute():
    # the lifespan itself runs one recompute on startup (scheduler.py), so
    # runs_total is asserted as a lower bound rather than an exact count
    from verdict_service.main import _recompute_job, app, contribution_edge_store, metrics

    contribution_edge_store._edges.clear()
    edges_before = metrics.contribution_edges_total
    lookups_before = metrics.reputation_lookups_total
    runs_before = metrics.recompute_runs_total

    with TestClient(app) as client:
        client.post("/v1/graph/contribute", json={"edges": [contribution_edge("m1", "p1")]})
        client.post("/v1/reputation/lookup", json={"prefixes": [f"{i:04x}" for i in range(32)]})
        asyncio.run(_recompute_job())
        body = client.get("/v1/metrics").text

    assert f"verdict_contribution_edges_total {edges_before + 1}" in body
    assert f"verdict_reputation_lookups_total {lookups_before + 1}" in body
    assert metrics.recompute_runs_total > runs_before


def test_a_contributed_batch_becomes_a_flagged_lookup_result_once_recomputed():
    from verdict_service.main import (
        _recompute_job,
        app,
        contribution_edge_store,
        flagged_hash_store,
    )

    contribution_edge_store._edges.clear()
    flagged_hash_store._hashes.clear()

    tight_group = ["f1", "f2"]
    products = ["p1", "p2", "p3"]
    edges = [
        contribution_edge(reviewer, product) for reviewer in tight_group for product in products
    ]
    edges += [
        contribution_edge("g1", "p4", star_rating=3),
        contribution_edge("g2", "p6", star_rating=1),
    ]
    edges += [contribution_edge("pad", product) for product in ["p5", "p7", "p8", "p9", "p10"]]

    with TestClient(app) as client:
        response = client.post("/v1/graph/contribute", json={"edges": edges})
        assert response.status_code == 200
        assert response.json() == {"accepted": len(edges)}

        asyncio.run(_recompute_job())

        real_prefixes = [full_hash(reviewer)[:4] for reviewer in tight_group]
        padding = [f"{i:04x}" for i in range(65536) if f"{i:04x}" not in real_prefixes]
        prefixes = real_prefixes + padding[: 32 - len(real_prefixes)]
        lookup = client.post("/v1/reputation/lookup", json={"prefixes": prefixes})

    assert lookup.status_code == 200
    matches = lookup.json()["matches"]
    for reviewer in tight_group:
        assert full_hash(reviewer) in matches[full_hash(reviewer)[:4]]
    assert full_hash("g1") not in [h for hashes in matches.values() for h in hashes]


class TestStoreSelection:
    @staticmethod
    def _load(monkeypatch, path):
        import importlib

        import verdict_service.main as main

        if path is None:
            monkeypatch.delenv("VERDICT_DATABASE_PATH", raising=False)
        else:
            monkeypatch.setenv("VERDICT_DATABASE_PATH", str(path))
        return importlib.reload(main)

    def test_defaults_to_memory_so_nothing_writes_a_file_unasked(self, monkeypatch):
        main = self._load(monkeypatch, None)
        assert type(main.flagged_hash_store).__name__ == "InMemoryFlaggedHashStore"
        assert type(main.contribution_edge_store).__name__ == "InMemoryContributionEdgeStore"

    def test_persists_when_a_path_is_configured(self, monkeypatch, tmp_path):
        database = tmp_path / "verdict.db"
        main = self._load(monkeypatch, database)
        try:
            assert type(main.flagged_hash_store).__name__ == "SqliteFlaggedHashStore"
            assert type(main.contribution_edge_store).__name__ == "SqliteContributionEdgeStore"
            assert database.exists()
        finally:
            self._load(monkeypatch, None)

    def test_both_stores_share_one_file(self, monkeypatch, tmp_path):
        main = self._load(monkeypatch, tmp_path / "verdict.db")
        try:
            main.flagged_hash_store.add("abcd1111")
            main.contribution_edge_store.prune_older_than(0.0)
            assert main.flagged_hash_store.matches("abcd") == ["abcd1111"]
        finally:
            self._load(monkeypatch, None)
