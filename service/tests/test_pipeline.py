from verdict_service.graph.community_scoring import ReviewRecord
from verdict_service.graph.contribution_store import ContributionEdge
from verdict_service.graph.hashing import reviewer_hash
from verdict_service.graph.pipeline import (
    compute_flagged_hashes,
    compute_flagged_hashes_from_contributions,
    flagged_hashes_with_sanitation,
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


def _contribution(reviewer, product, rating, week=2900, received_at=100.0):
    return ContributionEdge(
        reviewer_hash=reviewer,
        product_hash=product,
        star_rating=rating,
        week_bucket=week,
        verified=True,
        minhash_signature=[],
        received_at=received_at,
    )


_SHARED = ("p1", "p2", "p3")


def _honest_batch() -> list[ContributionEdge]:
    """the shape test_compute_flagged_hashes_end_to_end uses, with ratings that disagree.

    f1 and f2 co review the same three products, so they form a community, but
    one rates five and the other one, so rating homogeneity is zero and the
    community is not flagged.
    """
    return [
        *[_contribution("f1", product, 5) for product in _SHARED],
        *[_contribution("f2", product, 1) for product in _SHARED],
        _contribution("g1", "p4", 3),
        _contribution("g2", "p6", 1),
        *[_contribution("pad", product, 3) for product in ("p5", "p7", "p8", "p9", "p10")],
    ]


class TestContributionsAreSanitisedBeforeScoring:
    def test_an_honest_batch_flags_nobody(self):
        assert compute_flagged_hashes_from_contributions(_honest_batch()) == set()

    def test_resending_true_edges_cannot_flag_the_people_in_them(self):
        # every f1 edge resent three hundred times. without deduplication this
        # drags the community's rating variance to nearly zero, which reads as
        # rating homogeneity and flags two reviewers who did nothing.
        flood = [
            _contribution("f1", product, 5, received_at=float(i))
            for product in _SHARED
            for i in range(300)
        ]
        flagged, sanitised = flagged_hashes_with_sanitation(_honest_batch() + flood)
        assert sanitised.duplicates == 900
        assert flagged == set()

    def test_one_review_produces_one_record_however_many_people_saw_it(self):
        honest = _honest_batch()
        seen_by_many = [
            _contribution(
                edge.reviewer_hash,
                edge.product_hash,
                edge.star_rating,
                received_at=float(index),
            )
            for index in range(20)
            for edge in honest
        ]
        _, sanitised = flagged_hashes_with_sanitation(seen_by_many)
        assert sanitised.accepted == len(honest)

    def test_a_fabricated_contradiction_removes_the_pair_rather_than_deciding_it(self):
        contradicted = [_contribution("f1", "p1", 2)]
        _, sanitised = flagged_hashes_with_sanitation(_honest_batch() + contradicted)
        assert sanitised.conflicts == 2
        assert ("f1", "p1") not in {(e.reviewer_hash, e.product_hash) for e in sanitised.edges}

    def test_the_degree_cap_is_reported_rather_than_applied_silently(self):
        edges = [_contribution("r1", f"p{i}", 5, received_at=float(i)) for i in range(40)]
        _, sanitised = flagged_hashes_with_sanitation(edges, max_products_per_reviewer=5)
        assert sanitised.over_degree == 35

    def test_a_batch_with_nothing_to_clean_scores_exactly_as_before(self):
        honest = _honest_batch()
        flagged, sanitised = flagged_hashes_with_sanitation(honest)
        assert (sanitised.duplicates, sanitised.conflicts, sanitised.over_degree) == (0, 0, 0)
        assert flagged == compute_flagged_hashes_from_contributions(honest)
