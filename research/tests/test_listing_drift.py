from verdict_research.features.listing_drift import (
    MINIMUM_CHANGE_POINT_REVIEWS,
    MINIMUM_REPORTABLE_DRIFT,
    ChangePoint,
    ReviewForDrift,
    centroid_change_point,
    listing_identity_drift,
)
from verdict_research.features.text_embedding import embed_text

KNIFE = "stainless steel kitchen knife set"


def knife_review(index: int) -> ReviewForDrift:
    return ReviewForDrift(
        text=f"the kitchen knife set holds an edge, sharp stainless steel, review {index}"
    )


def cable_review(index: int) -> ReviewForDrift:
    return ReviewForDrift(
        text=f"charging cable arrived quickly and my phone battery fills fast, note {index}"
    )


def days(count: int, start: int = 20000) -> list[int | None]:
    return [start + i for i in range(count)]


def test_reports_nothing_when_no_review_carries_text():
    result = listing_identity_drift(
        [ReviewForDrift(text=None), ReviewForDrift(text="")], [None, None], KNIFE
    )
    assert result.off_topic_share is None
    assert result.mean_distance is None
    assert result.embedded_count == 0
    assert result.change_point is None


def test_counts_no_review_as_off_topic_when_every_one_matches():
    reviews = [knife_review(i) for i in range(20)]
    result = listing_identity_drift(reviews, days(20), KNIFE)
    assert result.off_topic_count == 0
    assert result.off_topic_share == 0
    assert result.mean_distance < 1


def test_counts_reviews_that_share_nothing_with_the_listing():
    reviews = [knife_review(i) for i in range(10)] + [cable_review(0)]
    result = listing_identity_drift(reviews, days(11), KNIFE)
    assert result.off_topic_count == 1
    assert abs(result.off_topic_share - 1 / 11) < 1e-12


def test_leaves_off_topic_share_none_without_product_text_and_still_runs_the_change_point():
    reviews = [knife_review(i) for i in range(12)] + [cable_review(i) for i in range(12)]
    result = listing_identity_drift(reviews, days(24), "")
    assert result.off_topic_share is None
    assert result.off_topic_count == 0
    assert result.change_point is not None


def test_dates_the_change_point_at_the_first_review_of_the_later_segment():
    reviews = [knife_review(i) for i in range(15)] + [cable_review(i) for i in range(15)]
    result = listing_identity_drift(reviews, days(30), KNIFE)
    assert result.change_point == ChangePoint(day=20015, after_count=15)
    assert result.drift_statistic > 0.9


def test_dates_nothing_on_a_listing_that_never_changed_subject():
    result = listing_identity_drift([knife_review(i) for i in range(30)], days(30), KNIFE)
    assert result.change_point is None
    assert result.drift_statistic < MINIMUM_REPORTABLE_DRIFT


def test_orders_by_date_rather_than_by_position():
    ordered = [knife_review(i) for i in range(15)] + [cable_review(i) for i in range(15)]
    ordered_days = days(30)
    indices = list(reversed(range(30)))
    shuffled = [ordered[i] for i in indices]
    shuffled_days = [ordered_days[i] for i in indices]
    assert (
        listing_identity_drift(shuffled, shuffled_days, KNIFE).change_point
        == listing_identity_drift(ordered, ordered_days, KNIFE).change_point
    )


def test_finds_no_change_point_below_the_minimum():
    count = MINIMUM_CHANGE_POINT_REVIEWS - 1
    reviews = [knife_review(i) for i in range(count // 2)] + [
        cable_review(i) for i in range(count - count // 2)
    ]
    result = listing_identity_drift(reviews, days(count), KNIFE)
    assert result.change_point is None
    assert result.drift_statistic == 0


def test_ignores_undated_reviews_in_the_change_point_but_still_measures_distance():
    reviews = [knife_review(i) for i in range(20)]
    result = listing_identity_drift(reviews, [None] * 20, KNIFE)
    assert result.embedded_count == 20
    assert result.change_point is None


def test_centroid_change_point_finds_no_drift_when_every_embedding_is_the_same():
    embedding = embed_text("one and the same")
    dated = [(embedding, 20000 + i) for i in range(20)]
    change_point, statistic = centroid_change_point(dated)
    assert change_point is None
    assert abs(statistic) < 1e-12
