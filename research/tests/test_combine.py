import math

import pytest

from verdict_research.features.feature_vector import FeatureVector
from verdict_research.features.listing_drift import ListingDriftResult
from verdict_research.features.rating_deconvolution import RatingDeconvolutionResult
from verdict_research.features.temporal_burst import TemporalBurstResult
from verdict_research.features.text_near_duplication import TextNearDuplicationResult
from verdict_research.features.verification_concentration import VerificationConcentrationResult
from verdict_research.model.combine import (
    CalibrationPoint,
    CombinerModel,
    apply_calibration,
    apply_model,
    flatten_feature_vector,
    quantile_value,
    signals_for,
)


def make_feature_vector(**overrides) -> FeatureVector:
    defaults = dict(
        meets_minimum_data=True,
        rating_deconvolution=RatingDeconvolutionResult(injected_share=0.5, residual_error=0.01),
        temporal_burst=TemporalBurstResult(
            bursts=[], burst_fraction=0.1, burst_count=1, largest_burst_share=0.1
        ),
        verification_concentration=VerificationConcentrationResult(lift=1.5, base_count=10),
        text_near_duplication=TextNearDuplicationResult(
            duplicate_review_share=0.25, cluster_count=2, largest_cluster_share=0.25
        ),
        listing_drift=ListingDriftResult(
            off_topic_share=None,
            off_topic_count=0,
            mean_distance=None,
            change_point=None,
            drift_statistic=0.0,
            embedded_count=0,
        ),
        reviewer_graph=None,
    )
    defaults.update(overrides)
    return FeatureVector(**defaults)


def test_flatten_exposes_every_numeric_leaf():
    flat = flatten_feature_vector(make_feature_vector())
    assert flat == {
        "ratingDeconvolution.injectedShare": 0.5,
        "ratingDeconvolution.residualError": 0.01,
        "temporalBurst.burstFraction": 0.1,
        "temporalBurst.burstCount": 1,
        "temporalBurst.largestBurstShare": 0.1,
        "verificationConcentration.lift": 1.5,
        "textNearDuplication.duplicateReviewShare": 0.25,
        "textNearDuplication.clusterCount": 2,
        "textNearDuplication.largestClusterShare": 0.25,
        "listingDrift.offTopicShare": None,
        "listingDrift.meanDistance": None,
        "listingDrift.driftStatistic": 0.0,
        "reviewerGraph.flaggedReviewShare": None,
    }


def test_flatten_nulls_out_a_missing_signal():
    flat = flatten_feature_vector(
        make_feature_vector(
            rating_deconvolution=None, temporal_burst=None, verification_concentration=None
        )
    )
    assert flat["ratingDeconvolution.injectedShare"] is None
    assert flat["temporalBurst.burstFraction"] is None
    assert flat["verificationConcentration.lift"] is None


@pytest.mark.parametrize(
    ("x", "expected"),
    [
        (0.25, 0.25),
        (0.5, 0.4),
        (-1, 0.1),
        (2, 0.9),
    ],
)
def test_apply_calibration_interpolates_and_clamps(x, expected):
    points = [CalibrationPoint(0, 0.1), CalibrationPoint(0.5, 0.4), CalibrationPoint(1, 0.9)]
    assert apply_calibration(points, x) == pytest.approx(expected)


def test_apply_calibration_is_identity_with_no_curve():
    assert apply_calibration([], 0.42) == 0.42


def test_apply_model_reports_insufficient_data():
    result = apply_model(
        make_feature_vector(meets_minimum_data=False),
        CombinerModel(intercept=0, coefficients={}),
    )
    assert result.status == "insufficient-data"


def test_apply_model_reports_missing_features_instead_of_imputing():
    result = apply_model(
        make_feature_vector(verification_concentration=None),
        CombinerModel(
            intercept=0,
            coefficients={
                "ratingDeconvolution.injectedShare": 3,
                "verificationConcentration.lift": 1,
            },
        ),
    )
    assert result.status == "missing-features"
    assert result.missing == ["verificationConcentration.lift"]


def test_apply_model_combines_linear_score_through_sigmoid_and_calibration():
    result = apply_model(
        make_feature_vector(),
        CombinerModel(
            intercept=-2,
            coefficients={
                "ratingDeconvolution.injectedShare": 3,
                "textNearDuplication.duplicateReviewShare": 2,
            },
            calibration=[CalibrationPoint(0, 0), CalibrationPoint(1, 1)],
        ),
    )
    assert result.status == "ok"
    assert result.raw_probability == pytest.approx(0.5)
    assert result.probability == pytest.approx(0.5)


def test_apply_model_calibration_moves_probability_away_from_raw():
    result = apply_model(
        make_feature_vector(),
        CombinerModel(
            intercept=-2,
            coefficients={
                "ratingDeconvolution.injectedShare": 3,
                "textNearDuplication.duplicateReviewShare": 2,
            },
            calibration=[
                CalibrationPoint(0, 0.1),
                CalibrationPoint(0.5, 0.8),
                CalibrationPoint(1, 0.9),
            ],
        ),
    )
    assert result.status == "ok"
    assert result.raw_probability == pytest.approx(0.5)
    assert result.probability == pytest.approx(0.8)


@pytest.mark.parametrize(
    ("fraction", "expected"),
    [(0.0, 0.0), (0.5, 0.5), (1.0, 1.0), (0.25, 0.25), (-1.0, 0.0), (2.0, 1.0)],
)
def test_quantile_value_interpolates_and_clamps(fraction, expected):
    assert quantile_value([0.0, 0.25, 0.5, 0.75, 1.0], fraction) == pytest.approx(expected)


def test_quantile_value_rejects_an_empty_sketch():
    with pytest.raises(ValueError):
        quantile_value([], 0.5)


def test_quantile_value_of_a_single_point_sketch_is_that_point():
    assert quantile_value([3.0], 0.9) == pytest.approx(3.0)


def imputing_model() -> CombinerModel:
    return CombinerModel(
        intercept=0,
        coefficients={
            "ratingDeconvolution.injectedShare": 3,
            "verificationConcentration.lift": 1,
        },
        feature_quantiles={"verificationConcentration.lift": [0.0, 1.0, 4.0]},
    )


def test_apply_model_imputes_a_missing_feature_when_asked():
    result = apply_model(
        make_feature_vector(verification_concentration=None), imputing_model(), impute=0.5
    )
    assert result.status == "ok"
    assert result.imputed == ["verificationConcentration.lift"]
    assert result.raw_probability == pytest.approx(1 / (1 + math.exp(-(3 * 0.5 + 1.0))))


def test_apply_model_imputation_fraction_moves_the_substituted_value():
    low = apply_model(
        make_feature_vector(verification_concentration=None), imputing_model(), impute=0.0
    )
    high = apply_model(
        make_feature_vector(verification_concentration=None), imputing_model(), impute=1.0
    )
    assert low.raw_probability < high.raw_probability


def test_apply_model_still_refuses_a_feature_the_model_carries_no_sketch_for():
    model = imputing_model()
    model.feature_quantiles = {}
    result = apply_model(make_feature_vector(verification_concentration=None), model, impute=0.5)
    assert result.status == "missing-features"


def test_apply_model_refuses_when_every_feature_would_be_imputed():
    result = apply_model(
        make_feature_vector(verification_concentration=None),
        CombinerModel(
            intercept=0,
            coefficients={"verificationConcentration.lift": 1},
            feature_quantiles={"verificationConcentration.lift": [0.0, 1.0, 4.0]},
        ),
        impute=0.5,
    )
    assert result.status == "insufficient-data"


def test_apply_model_reports_nothing_imputed_when_every_feature_is_present():
    result = apply_model(make_feature_vector(), imputing_model(), impute=0.5)
    assert result.status == "ok"
    assert result.imputed == []


def test_sigmoid_does_not_overflow_on_a_large_negative_score():
    result = apply_model(
        make_feature_vector(),
        CombinerModel(intercept=-10_000, coefficients={"ratingDeconvolution.injectedShare": 1}),
    )
    assert result.status == "ok"
    assert result.raw_probability == pytest.approx(0.0)


def test_signals_for_names_each_group_once_in_order():
    assert signals_for(
        [
            "temporalBurst.burstFraction",
            "temporalBurst.burstCount",
            "listingDrift.offTopicShare",
            "nothing.at.all",
        ]
    ) == ["arrival timing", "different product"]
