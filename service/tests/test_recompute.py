from verdict_service.api.store import InMemoryFlaggedHashStore
from verdict_service.graph.contribution_store import ContributionEdge, InMemoryContributionEdgeStore
from verdict_service.graph.recompute import RETENTION_SECONDS, recompute_flagged_hashes

# same hand checked tight_group / pad shape test_pipeline.py's
# TestComputeFlaggedHashesFromContributions already establishes flags
# f1 and f2 and never g1 or g2. Reused here because this module is only
# wiring that pipeline to the two stores, not re-deriving its scoring.
TIGHT_GROUP = ["f1", "f2"]


def edge(
    reviewer_hash: str, product_hash: str, received_at: float, star_rating: int = 5
) -> ContributionEdge:
    return ContributionEdge(
        reviewer_hash=reviewer_hash,
        product_hash=product_hash,
        star_rating=star_rating,
        week_bucket=10,
        verified=True,
        minhash_signature=[],
        received_at=received_at,
    )


def scenario_edges(received_at: float) -> list[ContributionEdge]:
    edges = [
        edge(reviewer, product, received_at)
        for reviewer in TIGHT_GROUP
        for product in ["p1", "p2", "p3"]
    ]
    edges += [
        edge("g1", "p4", received_at, star_rating=3),
        edge("g2", "p6", received_at, star_rating=1),
    ]
    edges += [edge("pad", product, received_at) for product in ["p5", "p7", "p8", "p9", "p10"]]
    return edges


def test_recompute_flags_a_significant_community_and_returns_its_size():
    contributions = InMemoryContributionEdgeStore()
    for e in scenario_edges(received_at=1_000.0):
        contributions.add(e)
    flagged_store = InMemoryFlaggedHashStore()

    count = recompute_flagged_hashes(contributions, flagged_store, now=lambda: 1_000.0)

    assert count == len(TIGHT_GROUP)
    for reviewer in TIGHT_GROUP:
        assert flagged_store.matches(reviewer[:4]) == [reviewer]
    assert flagged_store.matches("g1"[:4]) == []
    assert flagged_store.matches("g2"[:4]) == []


def test_recompute_excludes_edges_older_than_the_retention_window():
    contributions = InMemoryContributionEdgeStore()
    now = 10_000_000.0
    for e in scenario_edges(received_at=now - RETENTION_SECONDS - 1):
        contributions.add(e)
    flagged_store = InMemoryFlaggedHashStore()

    count = recompute_flagged_hashes(contributions, flagged_store, now=lambda: now)

    assert count == 0
    assert flagged_store.matches("f1"[:4]) == []


def test_a_previously_flagged_hash_survives_a_later_run_with_no_matching_edges():
    # PRIVACY.md section 8: raw edges are deleted after 90 days, but "only
    # the derived community assignments are kept". A later run computing
    # over a shrunken or reshaped edge set must never cause an earlier
    # flag to disappear, since flagged_store only ever grows.
    contributions = InMemoryContributionEdgeStore()
    for e in scenario_edges(received_at=1_000.0):
        contributions.add(e)
    flagged_store = InMemoryFlaggedHashStore()
    recompute_flagged_hashes(contributions, flagged_store, now=lambda: 1_000.0)
    assert flagged_store.matches("f1"[:4]) == ["f1"]

    contributions.prune_older_than(2_000.0)
    second_run_count = recompute_flagged_hashes(contributions, flagged_store, now=lambda: 2_000.0)

    assert second_run_count == 0
    assert flagged_store.matches("f1"[:4]) == ["f1"]
    assert flagged_store.matches("f2"[:4]) == ["f2"]


def test_recompute_with_no_contributions_flags_nothing():
    count = recompute_flagged_hashes(
        InMemoryContributionEdgeStore(), InMemoryFlaggedHashStore(), now=lambda: 0.0
    )
    assert count == 0
