from verdict_service.graph.contribution_store import ContributionEdge
from verdict_service.graph.sanitise import (
    edge_claim,
    edge_identity,
    sanitise_contributions,
)


def edge(
    reviewer="r1",
    product="p1",
    rating=5,
    week=2900,
    verified=True,
    received_at=100.0,
) -> ContributionEdge:
    return ContributionEdge(
        reviewer_hash=reviewer,
        product_hash=product,
        star_rating=rating,
        week_bucket=week,
        verified=verified,
        minhash_signature=[],
        received_at=received_at,
    )


class TestIdentityAndClaim:
    def test_identity_is_the_review_not_the_submission(self):
        assert edge_identity(edge(received_at=1.0)) == edge_identity(edge(received_at=2.0))

    def test_claim_is_what_the_submitter_asserts(self):
        assert edge_claim(edge(rating=5)) != edge_claim(edge(rating=4))
        assert edge_claim(edge(verified=True)) != edge_claim(edge(verified=None))


class TestDeduplication:
    def test_one_edge_survives_untouched(self):
        result = sanitise_contributions([edge()])
        assert result.accepted == 1
        assert result.duplicates == 0

    def test_the_same_review_seen_by_many_people_counts_once(self):
        submissions = [edge(received_at=float(i)) for i in range(10)]
        result = sanitise_contributions(submissions)
        assert result.accepted == 1
        assert result.duplicates == 9

    def test_it_keeps_the_earliest_sighting(self):
        result = sanitise_contributions([edge(received_at=900.0), edge(received_at=100.0)])
        assert result.edges[0].received_at == 100.0

    def test_different_reviews_by_one_reviewer_all_survive(self):
        result = sanitise_contributions([edge(product="p1"), edge(product="p2")])
        assert result.accepted == 2
        assert result.duplicates == 0

    def test_repetition_buys_no_weight_at_any_volume(self):
        flood = [edge(received_at=float(i)) for i in range(5_000)]
        honest = sanitise_contributions([edge()])
        poisoned = sanitise_contributions(flood)
        assert [e.received_at for e in poisoned.edges] == [0.0]
        assert poisoned.accepted == honest.accepted


class TestConflicts:
    def test_submitters_who_disagree_cancel_rather_than_outvote(self):
        result = sanitise_contributions([edge(rating=5), edge(rating=1)])
        assert result.accepted == 0
        assert result.conflicts == 2

    def test_sending_more_does_not_win_the_disagreement(self):
        loud = [edge(rating=1, received_at=float(i)) for i in range(100)]
        result = sanitise_contributions([edge(rating=5), *loud])
        assert result.accepted == 0

    def test_a_conflict_on_one_review_does_not_drop_another(self):
        result = sanitise_contributions(
            [edge(product="p1", rating=5), edge(product="p1", rating=1), edge(product="p2")]
        )
        assert [e.product_hash for e in result.edges] == ["p2"]

    def test_a_disagreement_about_the_week_is_still_a_disagreement(self):
        result = sanitise_contributions([edge(week=2900), edge(week=2901)])
        assert result.accepted == 0

    def test_a_disagreement_about_verification_is_still_a_disagreement(self):
        result = sanitise_contributions([edge(verified=True), edge(verified=None)])
        assert result.accepted == 0


class TestDegreeCaps:
    def test_a_reviewer_below_the_cap_is_untouched(self):
        edges = [edge(product=f"p{i}") for i in range(10)]
        result = sanitise_contributions(edges, max_products_per_reviewer=10)
        assert result.accepted == 10
        assert result.over_degree == 0

    def test_no_reviewer_can_be_made_a_hub_by_volume(self):
        edges = [edge(product=f"p{i}", received_at=float(i)) for i in range(50)]
        result = sanitise_contributions(edges, max_products_per_reviewer=10)
        assert result.accepted == 10
        assert result.over_degree == 40

    def test_the_cap_keeps_what_arrived_first(self):
        edges = [edge(product=f"p{i}", received_at=float(i)) for i in range(5)]
        result = sanitise_contributions(list(reversed(edges)), max_products_per_reviewer=2)
        assert sorted(e.product_hash for e in result.edges) == ["p0", "p1"]

    def test_a_later_flood_cannot_displace_what_was_already_there(self):
        established = [edge(reviewer="r1", product="p0", received_at=1.0)]
        flood = [edge(reviewer="r1", product=f"q{i}", received_at=1000.0) for i in range(50)]
        result = sanitise_contributions(established + flood, max_products_per_reviewer=3)
        assert "p0" in {e.product_hash for e in result.edges}

    def test_a_product_cannot_be_made_a_hub_by_volume(self):
        edges = [edge(reviewer=f"r{i}", received_at=float(i)) for i in range(50)]
        result = sanitise_contributions(edges, max_reviewers_per_product=10)
        assert result.accepted == 10

    def test_the_caps_are_independent(self):
        edges = [edge(reviewer=f"r{i}", product=f"p{i}") for i in range(20)]
        result = sanitise_contributions(
            edges, max_products_per_reviewer=1, max_reviewers_per_product=1
        )
        assert result.accepted == 20


class TestDeterminism:
    def test_the_same_edges_in_any_order_give_the_same_result(self):
        edges = [
            edge(reviewer="r1", product="p1", received_at=1.0),
            edge(reviewer="r1", product="p2", received_at=2.0),
            edge(reviewer="r2", product="p1", received_at=3.0),
        ]
        forward = sanitise_contributions(edges)
        backward = sanitise_contributions(list(reversed(edges)))
        assert forward.edges == backward.edges

    def test_an_empty_batch_is_an_empty_result(self):
        result = sanitise_contributions([])
        assert result.accepted == 0
        assert (result.duplicates, result.conflicts, result.over_degree) == (0, 0, 0)
