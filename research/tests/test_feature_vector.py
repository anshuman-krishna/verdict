import pytest

from verdict_research.features.feature_vector import (
    MINIMUM_DATED_REVIEW_COUNT,
    MINIMUM_HISTORY_DAYS,
    MINIMUM_REVIEW_COUNT,
    MINIMUM_TIMELINE_REVIEW_COUNT,
    FeatureVectorInputs,
    build_daily_counts,
    build_feature_vector,
    build_rating_histogram,
    day_index,
    derive_day_indices,
    derive_inside_burst,
    has_timeline,
    meets_minimum_data_thresholds,
    timeline_days,
)
from verdict_research.features.temporal_burst import Burst
from verdict_research.schema import Review

FLAT_PRIOR = [0.2, 0.2, 0.2, 0.2, 0.2]
KERNEL = [0, 0, 0, 0.35, 0.65]


def review(rating=None, text=None, date=None, verified=None, reviewer_id=None, date_precision=None):
    return Review(
        rating=rating,
        text=text,
        date=date,
        verified=verified,
        reviewer_id=reviewer_id,
        date_precision=date_precision,
    )


def coarse(count):
    return [review(rating=5, date="2024-01-15", date_precision="month") for _ in range(count)]


def test_a_coarse_date_counts_toward_the_dated_reviews():
    assert meets_minimum_data_thresholds(coarse(MINIMUM_REVIEW_COUNT))


def test_a_coarse_date_stays_out_of_the_timeline():
    reviews = coarse(MINIMUM_REVIEW_COUNT)
    assert timeline_days(reviews) == []
    assert build_daily_counts(reviews) is None


def test_a_coarse_sample_leaves_the_timeline_signals_unread():
    result = build_feature_vector(
        coarse(MINIMUM_REVIEW_COUNT), FeatureVectorInputs(FLAT_PRIOR, KERNEL)
    )
    assert result.temporal_burst is None
    assert result.verification_concentration is None
    assert result.meets_minimum_data
    assert result.rating_deconvolution is not None


def test_a_coarse_date_never_names_the_day_a_listing_changed():
    reviews = [
        review(date="2024-01-03"),
        review(date="2024-01-03", date_precision="day"),
        review(date="2024-01-03", date_precision="month"),
        review(),
    ]
    day = day_index("2024-01-03")
    assert derive_day_indices(reviews) == [day, day, None, None]


def test_a_coarse_date_is_never_inside_a_burst():
    reviews = [review(date="2024-01-03", date_precision="month")]
    bursts = [Burst(start_day=0, end_day=100, review_count=1)]
    assert derive_inside_burst(reviews, day_index("2024-01-01"), bursts) == [False]


def test_a_week_is_as_coarse_as_a_month_and_a_day_is_not():
    assert timeline_days([review(date="2024-01-03", date_precision="week")]) == []
    assert len(timeline_days([review(date="2024-01-03", date_precision="day")])) == 1
    assert len(timeline_days([review(date="2024-01-03", date_precision="exact")])) == 1
    assert len(timeline_days([review(date="2024-01-03")])) == 1


def test_the_span_comes_back_once_there_is_a_timeline_to_measure():
    assert not has_timeline(coarse(MINIMUM_REVIEW_COUNT))
    mixed = coarse(MINIMUM_REVIEW_COUNT) + [
        review(rating=5, date="2024-01-15", date_precision="day")
        for _ in range(MINIMUM_TIMELINE_REVIEW_COUNT)
    ]
    assert has_timeline(mixed)
    assert not meets_minimum_data_thresholds(mixed)


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


@pytest.mark.parametrize(
    "raw",
    [
        "3 janvier 2026",
        "3. Januar 2026",
        "Reviewed in the United States on January 3, 2026",
        "January 3, 2026",
        "03/01/2026",
        "",
    ],
)
def test_day_index_refuses_anything_that_is_not_an_iso_date(raw):
    with pytest.raises(ValueError, match="iso date"):
        day_index(raw)


def test_the_reviewer_graph_is_absent_unless_a_lookup_supplied_its_input():
    reviews = [
        Review(rating=5, text="a", date="2024-01-01", verified=True, reviewer_id="a")
        for _ in range(3)
    ]
    inputs = FeatureVectorInputs(organic_prior=FLAT_PRIOR, injection_kernel=KERNEL)
    assert build_feature_vector(reviews, inputs).reviewer_graph is None


def test_the_reviewer_graph_runs_once_a_lookup_supplied_its_input():
    reviews = [
        Review(rating=5, text="a", date="2024-01-01", verified=True, reviewer_id=f"r{i}")
        for i in range(4)
    ]
    inputs = FeatureVectorInputs(
        organic_prior=FLAT_PRIOR, injection_kernel=KERNEL, flagged_reviewer_ids={"r0", "r1"}
    )
    result = build_feature_vector(reviews, inputs).reviewer_graph
    assert result is not None
    assert result.flagged_review_share == 0.5


def test_an_empty_flagged_set_still_produces_a_result():
    reviews = [
        Review(rating=5, text="a", date="2024-01-01", verified=True, reviewer_id="a")
        for _ in range(3)
    ]
    inputs = FeatureVectorInputs(
        organic_prior=FLAT_PRIOR, injection_kernel=KERNEL, flagged_reviewer_ids=set()
    )
    result = build_feature_vector(reviews, inputs).reviewer_graph
    assert result is not None
    assert result.flagged_review_share == 0
