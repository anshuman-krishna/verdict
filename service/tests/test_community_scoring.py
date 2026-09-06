import pytest

from verdict_service.graph.backbone import BackboneEdge
from verdict_service.graph.community_scoring import (
    ReviewRecord,
    category_incoherence,
    graph_density,
    rating_homogeneity,
    score_community,
    temporal_clustering,
)


class TestGraphDensity:
    def test_hand_computed_a_triangle_missing_one_edge(self):
        edges = [BackboneEdge("a", "b", 1.0), BackboneEdge("a", "c", 1.0)]
        assert graph_density(["a", "b", "c"], edges) == pytest.approx(2 / 3)

    def test_a_complete_triangle_has_density_one(self):
        edges = [
            BackboneEdge("a", "b", 1.0),
            BackboneEdge("a", "c", 1.0),
            BackboneEdge("b", "c", 1.0),
        ]
        assert graph_density(["a", "b", "c"], edges) == 1.0

    def test_ignores_edges_that_leave_the_community(self):
        edges = [BackboneEdge("a", "b", 1.0), BackboneEdge("a", "outsider", 1.0)]
        assert graph_density(["a", "b"], edges) == 1.0

    def test_a_community_of_fewer_than_two_has_no_density(self):
        assert graph_density(["a"], []) == 0.0


class TestRatingHomogeneity:
    def test_identical_ratings_are_fully_homogeneous(self):
        assert rating_homogeneity([5, 5, 5]) == 1.0

    def test_hand_computed_a_maximally_split_scale(self):
        # mean 3, variance ((1-3)^2 + (5-3)^2) / 2 = 4, stddev 2,
        # homogeneity = 1 - 2/2 = 0
        assert rating_homogeneity([1, 5]) == pytest.approx(0.0)

    def test_hand_computed_a_partial_spread(self):
        # mean 4.5, variance 0.25, stddev 0.5, homogeneity = 1 - 0.5/2 = 0.75
        assert rating_homogeneity([4, 5, 4, 5]) == pytest.approx(0.75)

    def test_fewer_than_two_ratings_is_no_evidence_not_full_homogeneity(self):
        assert rating_homogeneity([5]) == 0.0
        assert rating_homogeneity([]) == 0.0


class TestTemporalClustering:
    def test_same_day_reviews_are_maximally_clustered(self):
        assert temporal_clustering([10, 10, 10]) == 1.0

    def test_hand_computed_a_year_wide_spread_is_zero(self):
        assert temporal_clustering([0, 365]) == pytest.approx(0.0)

    def test_hand_computed_a_partial_spread(self):
        assert temporal_clustering([0, 100]) == pytest.approx(265 / 365)

    def test_fewer_than_two_dates_is_no_evidence(self):
        assert temporal_clustering([5]) == 0.0


class TestCategoryIncoherence:
    def test_a_single_category_is_fully_coherent(self):
        assert category_incoherence(["kitchen", "kitchen", "kitchen"]) == 0.0

    def test_hand_computed_an_even_two_way_split_is_maximally_incoherent(self):
        assert category_incoherence(["a", "b"]) == pytest.approx(1.0)

    def test_hand_computed_an_uneven_two_way_split(self):
        assert category_incoherence(["a", "a", "b"]) == pytest.approx(0.9183, abs=1e-4)

    def test_empty_input_is_no_evidence(self):
        assert category_incoherence([]) == 0.0


class TestScoreCommunity:
    def test_combines_the_four_components_as_an_unweighted_mean(self):
        community = ["a", "b", "c"]
        edges = [
            BackboneEdge("a", "b", 1.0),
            BackboneEdge("a", "c", 1.0),
            BackboneEdge("b", "c", 1.0),
        ]
        reviews = [
            ReviewRecord(reviewer_id="a", rating=5, day_index=10, category="kitchen"),
            ReviewRecord(reviewer_id="b", rating=5, day_index=10, category="kitchen"),
            ReviewRecord(reviewer_id="c", rating=5, day_index=10, category="kitchen"),
        ]
        score = score_community(community, edges, reviews)
        # density 1.0, homogeneity 1.0, clustering 1.0, incoherence 0.0
        # (only one category): combined = (1+1+1+0)/4 = 0.75
        assert score.combined == pytest.approx(0.75)
        assert score.flagged is True

    def test_a_loose_uncorrelated_community_is_not_flagged(self):
        community = ["a", "b"]
        edges: list[BackboneEdge] = []
        reviews = [
            ReviewRecord(reviewer_id="a", rating=1, day_index=0, category="kitchen"),
            ReviewRecord(reviewer_id="b", rating=5, day_index=365, category="electronics"),
        ]
        score = score_community(community, edges, reviews)
        assert score.flagged is False

    def test_only_counts_reviews_from_members_of_this_community(self):
        community = ["a"]
        reviews = [
            ReviewRecord(reviewer_id="a", rating=5, day_index=0, category="kitchen"),
            ReviewRecord(reviewer_id="outsider", rating=1, day_index=900, category="toys"),
        ]
        score = score_community(community, [], reviews)
        # only "a"'s single review counts, which is too few for either
        # homogeneity or clustering to have an opinion
        assert score.rating_homogeneity == 0.0
        assert score.temporal_clustering == 0.0

    def test_a_custom_flag_threshold_is_respected(self):
        community = ["a", "b", "c"]
        edges = [
            BackboneEdge("a", "b", 1.0),
            BackboneEdge("a", "c", 1.0),
            BackboneEdge("b", "c", 1.0),
        ]
        reviews = [
            ReviewRecord(reviewer_id="a", rating=5, day_index=10, category="kitchen"),
            ReviewRecord(reviewer_id="b", rating=5, day_index=10, category="kitchen"),
            ReviewRecord(reviewer_id="c", rating=5, day_index=10, category="kitchen"),
        ]
        # combined is 0.75 (see above); a threshold above that flips it
        assert score_community(community, edges, reviews, flag_threshold=0.9).flagged is False
