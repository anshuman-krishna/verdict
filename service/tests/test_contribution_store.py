from verdict_service.graph.contribution_store import ContributionEdge, InMemoryContributionEdgeStore


def edge(received_at: float) -> ContributionEdge:
    return ContributionEdge(
        reviewer_hash="a" * 64,
        product_hash="b" * 64,
        star_rating=5,
        week_bucket=2800,
        verified=True,
        minhash_signature=[],
        received_at=received_at,
    )


def test_list_since_returns_only_edges_at_or_after_the_cutoff():
    store = InMemoryContributionEdgeStore()
    store.add(edge(10))
    store.add(edge(20))
    store.add(edge(30))
    assert [e.received_at for e in store.list_since(20)] == [20, 30]


def test_list_since_zero_returns_everything():
    store = InMemoryContributionEdgeStore()
    store.add(edge(10))
    store.add(edge(20))
    assert len(store.list_since(0)) == 2


def test_prune_older_than_removes_only_edges_before_the_cutoff_and_reports_how_many():
    store = InMemoryContributionEdgeStore()
    store.add(edge(10))
    store.add(edge(20))
    store.add(edge(30))

    pruned = store.prune_older_than(20)

    assert pruned == 1
    assert [e.received_at for e in store.list_since(0)] == [20, 30]


def test_prune_older_than_with_nothing_to_prune_returns_zero_and_changes_nothing():
    store = InMemoryContributionEdgeStore()
    store.add(edge(20))
    assert store.prune_older_than(0) == 0
    assert len(store.list_since(0)) == 1
