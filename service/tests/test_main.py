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
    # TestClient used as a context manager runs main.py's lifespan
    # startup and shutdown, the only way asyncio.create_task's scheduled
    # loop ever runs at all: this is a smoke test that the wiring itself
    # (the import, the task creation, the cancel on shutdown) is sound,
    # not a test of RECOMPUTE_INTERVAL_SECONDS's hour long cadence.
    #
    # imported inside the test, not at module level: test_logging_config.py's
    # test_importing_main_disables_the_access_logger relies on being the
    # first thing in the process to import verdict_service.main, and a
    # module level import here would run at collection time, before any
    # test body executes, and beat it there.
    from verdict_service.main import app

    with TestClient(app):
        pass


def test_a_contributed_batch_becomes_a_flagged_lookup_result_once_recomputed():
    # same tight_group / pad shape as test_pipeline.py and
    # test_recompute.py's hand checked scenario, submitted through the
    # real HTTP contribution endpoint this time, then folded into
    # flagged_hash_store by calling the same job the schedule runs,
    # directly rather than waiting an hour for it.
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

        _recompute_job()

        real_prefixes = [full_hash(reviewer)[:4] for reviewer in tight_group]
        padding = [f"{i:04x}" for i in range(65536) if f"{i:04x}" not in real_prefixes]
        prefixes = real_prefixes + padding[: 32 - len(real_prefixes)]
        lookup = client.post("/v1/reputation/lookup", json={"prefixes": prefixes})

    assert lookup.status_code == 200
    matches = lookup.json()["matches"]
    for reviewer in tight_group:
        assert full_hash(reviewer) in matches[full_hash(reviewer)[:4]]
    assert full_hash("g1") not in [h for hashes in matches.values() for h in hashes]
