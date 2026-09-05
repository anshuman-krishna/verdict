import pytest

from verdict_research.features.feature_vector import (
    MINIMUM_DATED_REVIEW_COUNT,
    MINIMUM_HISTORY_DAYS,
    MINIMUM_REVIEW_COUNT,
    FeatureVectorInputs,
    build_daily_counts,
    build_feature_vector,
    build_rating_histogram,
    day_index,
    derive_inside_burst,
    meets_minimum_data_thresholds,
)
from verdict_research.features.temporal_burst import Burst
from verdict_research.schema import Review


def review(rating=None, text=None, date=None, verified=None, reviewer_id=None):
    return Review(rating=rating, text=text, date=date, verified=verified, reviewer_id=reviewer_id)


def test_day_index_hand_computed_2024_03_15_is_19797_days_after_epoch():
    assert day_index("2024-03-15") == 19797


def test_day_index_agrees_for_date_only_and_utc_midnight():
    assert day_index("2024-03-15") == day_index("2024-03-15T00:00:00Z")


def test_day_index_rejects_a_datetime_with_no_explicit_time_zone():
    with pytest.raises(ValueError, match="explicit time zone"):
        day_index("2024-03-15T10:00:00")


def test_meets_minimum_data_thresholds_fails_below_minimum_review_count():
    reviews = [review(date="2024-01-01") for _ in range(MINIMUM_REVIEW_COUNT - 1)]
    assert meets_minimum_data_thresholds(reviews) is False


def test_meets_minimum_data_thresholds_fails_below_minimum_dated_count():
    dated = [review(date="2024-01-01") for _ in range(MINIMUM_DATED_REVIEW_COUNT - 1)]
    undated = [review() for _ in range(MINIMUM_REVIEW_COUNT - len(dated))]
    assert meets_minimum_data_thresholds(dated + undated) is False


def test_meets_minimum_data_thresholds_fails_when_span_is_too_short():
    reviews = [
        review(date="2024-01-01") if i < MINIMUM_DATED_REVIEW_COUNT else review()
        for i in range(MINIMUM_REVIEW_COUNT)
    ]
    assert meets_minimum_data_thresholds(reviews) is False


def test_meets_minimum_data_thresholds_passes_when_exactly_met():
    reviews = []
    for i in range(MINIMUM_REVIEW_COUNT):
        if i == 0:
            reviews.append(review(date="2024-01-01"))
        elif i == 1:
            reviews.append(review(date=f"2024-01-{1 + MINIMUM_HISTORY_DAYS}"))
        elif i < MINIMUM_DATED_REVIEW_COUNT:
            reviews.append(review(date="2024-01-05"))
        else:
            reviews.append(review())
    assert meets_minimum_data_thresholds(reviews) is True


def test_build_rating_histogram_hand_computed_split():
    reviews = [review(rating=5), review(rating=5), review(rating=1), review(rating=1)]
    assert build_rating_histogram(reviews) == [0.5, 0, 0, 0, 0.5]


def test_build_rating_histogram_returns_none_with_no_ratings():
    assert build_rating_histogram([review(), review()]) is None


def test_build_daily_counts_hand_computed():
    reviews = [review(date="2024-01-01"), review(date="2024-01-01"), review(date="2024-01-04")]
    result = build_daily_counts(reviews)
    assert result.daily_counts == [2, 0, 0, 1]


def test_build_daily_counts_returns_none_with_no_dates():
    assert build_daily_counts([review(), review()]) is None


def test_derive_inside_burst_hand_computed():
    reviews = [review(date="2024-01-03"), review(date="2024-01-10")]
    min_day = day_index("2024-01-01")
    result = derive_inside_burst(reviews, min_day, [Burst(start_day=1, end_day=3, review_count=5)])
    assert result == [True, False]


def test_derive_inside_burst_treats_undated_review_as_never_inside():
    result = derive_inside_burst([review()], 0, [Burst(start_day=0, end_day=100, review_count=1)])
    assert result == [False]


def test_build_feature_vector_assembles_all_four_signals():
    reviews = [
        review(rating=5, text="great product, works well", date="2024-01-01", verified=True),
        review(rating=5, text="great product, works well", date="2024-01-01", verified=False),
        review(rating=1, text="did not work for me at all", date="2024-01-20", verified=True),
    ]
    result = build_feature_vector(
        reviews,
        FeatureVectorInputs(
            organic_prior=[0.1, 0.1, 0.2, 0.3, 0.3], injection_kernel=[0, 0, 0, 0.3, 0.7]
        ),
    )
    assert result.rating_deconvolution is not None
    assert result.temporal_burst is not None
    assert result.text_near_duplication.cluster_count == 1
    assert result.meets_minimum_data is False


def test_build_feature_vector_leaves_signals_none_without_data():
    reviews = [review(text="some text with no rating or date at all here")]
    inputs = FeatureVectorInputs(organic_prior=[0, 0, 0, 0, 0], injection_kernel=[0, 0, 0, 0, 0])
    result = build_feature_vector(reviews, inputs)
    assert result.rating_deconvolution is None
    assert result.temporal_burst is None
    assert result.verification_concentration is None
