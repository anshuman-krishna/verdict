import asyncio
import threading
import time

from verdict_service.graph.contribution_store import ContributionEdge
from verdict_service.graph.sqlite_store import (
    SqliteContributionEdgeStore,
    SqliteFlaggedHashStore,
    connect,
)


def edge(index: int) -> ContributionEdge:
    return ContributionEdge(
        reviewer_hash=f"{index:064x}",
        product_hash="b" * 64,
        star_rating=5,
        week_bucket=2900,
        verified=True,
        minhash_signature=["1"],
        received_at=float(index),
    )


def run_all(targets):
    errors: list[str] = []

    def guard(fn):
        def wrapped():
            try:
                fn()
            except Exception as error:  # noqa: BLE001 - the point is to record, not propagate
                errors.append(f"{type(error).__name__}: {error}")

        return wrapped

    threads = [threading.Thread(target=guard(t)) for t in targets]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return errors


def test_concurrent_writers_lose_nothing(tmp_path):
    store = SqliteContributionEdgeStore(connect(tmp_path / "v.db"))
    errors = run_all(
        [
            lambda: [store.add(edge(i)) for i in range(0, 200)],
            lambda: [store.add(edge(i)) for i in range(200, 400)],
            lambda: [store.add(edge(i)) for i in range(400, 600)],
        ]
    )
    assert errors == []
    assert len(store.list_since(0.0)) == 600


def test_a_reader_alongside_writers_never_errors(tmp_path):
    database = connect(tmp_path / "v.db")
    edges = SqliteContributionEdgeStore(database)
    flagged = SqliteFlaggedHashStore(database)
    errors = run_all(
        [
            lambda: [edges.add(edge(i)) for i in range(300)],
            lambda: [edges.list_since(0.0) for _ in range(200)],
            lambda: [flagged.matches("abcd") for _ in range(200)],
            lambda: [flagged.add_many([f"{i:064x}"]) for i in range(200)],
        ]
    )
    assert errors == []
    assert len(edges.list_since(0.0)) == 300


def test_both_stores_share_one_lock_when_they_share_a_file(tmp_path):
    database = connect(tmp_path / "v.db")
    edges = SqliteContributionEdgeStore(database)
    flagged = SqliteFlaggedHashStore(database)
    errors = run_all(
        [
            lambda: [edges.add(edge(i)) for i in range(200)],
            lambda: [flagged.add(f"{i:064x}") for i in range(200)],
        ]
    )
    assert errors == []
    assert len(edges.list_since(0.0)) == 200
    assert len(flagged.matches("")) == 200


def test_the_recompute_job_does_not_run_on_the_event_loop():
    import verdict_service.main as main

    assert asyncio.iscoroutinefunction(main._recompute_job)


def test_a_slow_recompute_leaves_the_loop_free():
    import verdict_service.main as main

    started = threading.Event()

    def slow() -> None:
        started.set()
        time.sleep(0.3)

    async def scenario() -> float:
        task = asyncio.create_task(asyncio.to_thread(slow))
        started.wait(1.0)
        began = time.monotonic()
        await asyncio.sleep(0.01)
        elapsed = time.monotonic() - began
        await task
        return elapsed

    assert asyncio.run(scenario()) < 0.2
    assert main.RECOMPUTE_INTERVAL_SECONDS > 0
