from verdict_service.graph.community_scoring import ReviewRecord
from verdict_service.graph.contribution_store import ContributionEdge
from verdict_service.graph.hashing import reviewer_hash
from verdict_service.graph.pipeline import (
    compute_flagged_hashes,
    compute_flagged_hashes_from_contributions,
)

SALT = "test-salt"


def test_compute_flagged_hashes_end_to_end():
    tight_group = ["f1", "f2"]
    reviewer_products = {
        **{reviewer: {"p1", "p2", "p3"} for reviewer in tight_group},
        "g1": {"p4"},
        "g2": {"p6"},
        "pad": {"p5", "p7", "p8", "p9", "p10"},
    }
    reviews = [
        ReviewRecord(reviewer_id=reviewer, rating=5, day_index=100, category="kitchen")
        for reviewer in tight_group
    ] + [
        ReviewRecord(reviewer_id="g1", rating=3, day_index=10, category="toys"),
        ReviewRecord(reviewer_id="g2", rating=1, day_index=900, category="electronics"),
    ]

    flagged = compute_flagged_hashes(reviewer_products, reviews, SALT)

    assert flagged == {reviewer_hash(reviewer, SALT) for reviewer in tight_group}
    assert reviewer_hash("g1", SALT) not in flagged
    assert reviewer_hash("g2", SALT) not in flagged


def test_compute_flagged_hashes_is_empty_with_no_significant_overlap():
    reviewer_products = {"a": {"p1"}, "b": {"p2"}}
    assert compute_flagged_hashes(reviewer_products, [], SALT) == set()


def test_compute_flagged_hashes_does_not_flag_a_loosely_correlated_community():
    reviewer_products = {
        "a": {"p1", "p2", "p3"},
        "b": {"p1", "p2", "p3"},
        "pad": {"p4", "p5", "p6", "p7", "p8", "p9", "p10"},
    }
    reviews = [
        ReviewRecord(reviewer_id="a", rating=1, day_index=0, category="kitchen"),
        ReviewRecord(reviewer_id="b", rating=5, day_index=365, category="electronics"),
    ]
    assert compute_flagged_hashes(reviewer_products, reviews, SALT) == set()


def contribution_edge(
    reviewer_hash: str, product_hash: str, star_rating: int = 5, week_bucket: int = 10
) -> ContributionEdge:
    return ContributionEdge(
        reviewer_hash=reviewer_hash,
        product_hash=product_hash,
        star_rating=star_rating,
        week_bucket=week_bucket,
        verified=True,
        minhash_signature=[],
        received_at=0.0,
    )


class TestComputeFlaggedHashesFromContributions:
    def test_end_to_end_reuses_the_same_hand_checked_scenario_as_compute_flagged_hashes(self):
        tight_group = ["f1", "f2"]
        edges = [
            contribution_edge(reviewer, product, star_rating=5, week_bucket=10)
            for reviewer in tight_group
            for product in ["p1", "p2", "p3"]
        ]
        edges += [
            contribution_edge("g1", "p4", star_rating=3, week_bucket=1),
            contribution_edge("g2", "p6", star_rating=1, week_bucket=90),
        ]
        edges += [
            contribution_edge("pad", product, week_bucket=10)
            for product in ["p5", "p7", "p8", "p9", "p10"]
        ]

        flagged = compute_flagged_hashes_from_contributions(edges)

        assert flagged == set(tight_group)
        assert "g1" not in flagged
        assert "g2" not in flagged

    def test_is_empty_with_no_significant_overlap(self):
        edges = [contribution_edge("a", "p1"), contribution_edge("b", "p2")]
        assert compute_flagged_hashes_from_contributions(edges) == set()

    def test_is_empty_with_no_edges_at_all(self):
        assert compute_flagged_hashes_from_contributions([]) == set()

    def test_does_not_flag_a_significant_overlap_whose_actual_reviews_look_nothing_alike(self):
        edges = [
            contribution_edge("a", "p1", star_rating=1, week_bucket=0),
            contribution_edge("a", "p2", star_rating=1, week_bucket=0),
            contribution_edge("a", "p3", star_rating=1, week_bucket=0),
            contribution_edge("b", "p1", star_rating=5, week_bucket=52),
            contribution_edge("b", "p2", star_rating=5, week_bucket=52),
            contribution_edge("b", "p3", star_rating=5, week_bucket=52),
        ] + [
            contribution_edge("pad", product)
            for product in ["p4", "p5", "p6", "p7", "p8", "p9", "p10"]
        ]
        assert compute_flagged_hashes_from_contributions(edges) == set()

    def test_converts_week_bucket_to_an_approximate_day_index_rather_than_treating_it_as_days(self):
        edges = [
            contribution_edge("a", "p1", week_bucket=0),
            contribution_edge("a", "p2", week_bucket=0),
            contribution_edge("a", "p3", week_bucket=0),
            contribution_edge("b", "p1", week_bucket=52),
            contribution_edge("b", "p2", week_bucket=52),
            contribution_edge("b", "p3", week_bucket=52),
        ] + [
            contribution_edge("pad", product)
            for product in ["p4", "p5", "p6", "p7", "p8", "p9", "p10"]
        ]
        assert compute_flagged_hashes_from_contributions(edges) == set()
