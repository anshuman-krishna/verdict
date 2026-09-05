import pytest

from verdict_research.features.feature_vector import FeatureVector
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
