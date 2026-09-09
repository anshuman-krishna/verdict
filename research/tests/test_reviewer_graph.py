from verdict_research.features.reviewer_graph import (
    ReviewForReviewerGraph,
    reviewer_graph_share,
)


def reviews(ids):
    return [ReviewForReviewerGraph(reviewer_id=reviewer_id) for reviewer_id in ids]


def test_reports_the_share_of_reviews_written_by_flagged_accounts():
    result = reviewer_graph_share(reviews(["a", "b", "c", "d"]), {"a", "c"})
    assert result.flagged_review_share == 0.5
    assert result.flagged_review_count == 2
    assert result.identified_review_count == 4


def test_counts_reviews_not_reviewers_while_reporting_both():
    result = reviewer_graph_share(reviews(["a", "a", "a", "b"]), {"a"})
    assert result.flagged_review_share == 0.75
    assert result.flagged_reviewer_count == 1
    assert result.known_reviewer_count == 2


def test_skips_reviews_with_no_reviewer_id():
    result = reviewer_graph_share(reviews(["a", None, None]), {"a"})
    assert result.flagged_review_share == 1
    assert result.identified_review_count == 1


def test_reports_none_when_no_review_carries_a_reviewer_id():
    result = reviewer_graph_share(reviews([None, None]), {"a"})
    assert result.flagged_review_share is None
    assert result.identified_review_count == 0


def test_reports_zero_rather_than_none_when_the_lookup_found_nothing():
    result = reviewer_graph_share(reviews(["a", "b"]), set())
    assert result.flagged_review_share == 0
    assert result.flagged_reviewer_count == 0


def test_ignores_flagged_ids_that_do_not_appear_on_this_listing():
    result = reviewer_graph_share(reviews(["a"]), {"a", "x", "y"})
    assert result.flagged_reviewer_count == 1
    assert result.known_reviewer_count == 1


def test_handles_an_empty_review_set():
    assert reviewer_graph_share([], {"a"}).flagged_review_share is None
