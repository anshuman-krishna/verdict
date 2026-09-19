import pytest

from verdict_research.dispute.document import DOCUMENT_VERSION, parse_report_document
from verdict_research.dispute.reproduce import reproduce
from verdict_research.model.artifact import ArtifactError
from verdict_research.model.combine import (
    MEDIAN_FRACTION,
    CalibrationPoint,
    CombinerModel,
    CombinerOk,
    score_features,
)

COEFFICIENTS = {
    "ratingDeconvolution.injectedShare": 2.5,
    "temporalBurst.burstFraction": 1.25,
}

QUANTILES = {"temporalBurst.burstFraction": [0.0, 0.2, 0.4]}


def artifact(**overrides):
    base = {
        "artifactVersion": 1,
        "present": True,
        "trainedAt": 1_690_000_000_000,
        "intercept": -1.0,
        "coefficients": dict(COEFFICIENTS),
        "calibration": [],
        "featureQuantiles": {k: list(v) for k, v in QUANTILES.items()},
    }
    base.update(overrides)
    return base


def expected_probability(features):
    model = CombinerModel(
        intercept=-1.0,
        coefficients=dict(COEFFICIENTS),
        calibration=[],
        feature_quantiles={k: list(v) for k, v in QUANTILES.items()},
    )
    result = score_features(model, dict(features), impute=MEDIAN_FRACTION)
    assert isinstance(result, CombinerOk)
    return result.probability


def document(features, probability):
    return parse_report_document(
        {
            "documentVersion": DOCUMENT_VERSION,
            "exportedAt": 1_700_000_000_000,
            "title": "a stovetop kettle",
            "report": {
                "serial": "7F2A-0091",
                "band": "mixed",
                "probability": probability,
                "unavailableSignals": [],
                "absentSignals": [],
            },
            "features": features,
        }
    )


FEATURES = {
    "ratingDeconvolution.injectedShare": 0.4,
    "temporalBurst.burstFraction": 0.6,
}


def test_a_report_that_was_scored_by_this_model_reproduces_exactly():
    probability = expected_probability(FEATURES)

    result = reproduce(document(FEATURES, probability), artifact())

    assert result.agrees
    assert result.problems == []
    assert result.probability == pytest.approx(probability)
    assert result.difference == pytest.approx(0.0)


def test_a_report_whose_number_does_not_follow_from_its_own_features_says_so():
    result = reproduce(document(FEATURES, 0.01), artifact())

    assert not result.agrees
    assert len(result.problems) == 1
    assert "Either the model changed since the check, or the document did" in result.problems[0]


def test_names_every_signal_the_model_weighed_largest_mover_first():
    result = reproduce(document(FEATURES, expected_probability(FEATURES)), artifact())

    assert [row.key for row in result.contributions] == [
        "ratingDeconvolution.injectedShare",
        "temporalBurst.burstFraction",
    ]
    first = result.contributions[0]
    assert first.value == pytest.approx(0.4)
    assert first.coefficient == pytest.approx(2.5)
    assert first.contribution == pytest.approx(1.0)
    assert not first.imputed


def test_a_signal_the_page_did_not_carry_is_named_as_filled_from_the_sketch():
    features = {"ratingDeconvolution.injectedShare": 0.4, "temporalBurst.burstFraction": None}

    result = reproduce(document(features, expected_probability(features)), artifact())

    filled = next(row for row in result.contributions if row.key == "temporalBurst.burstFraction")
    assert filled.imputed
    assert filled.value == pytest.approx(0.2)
    assert result.agrees


def test_picks_the_reviewer_graph_model_when_the_report_carried_that_signal():
    graph_coefficients = {**COEFFICIENTS, "reviewerGraph.flaggedReviewShare": 3.0}
    with_graph = artifact(
        reviewerGraph={
            "intercept": -1.0,
            "coefficients": graph_coefficients,
            "calibration": [],
            "featureQuantiles": {k: list(v) for k, v in QUANTILES.items()},
        }
    )
    features = {**FEATURES, "reviewerGraph.flaggedReviewShare": 0.1}

    result = reproduce(document(features, 0.5), with_graph)

    assert result.slot == "reviewerGraph"
    assert any(row.key == "reviewerGraph.flaggedReviewShare" for row in result.contributions)


def test_stays_on_the_local_model_when_the_report_had_no_reviewer_signal():
    assert reproduce(document(FEATURES, 0.5), artifact()).slot == "local"


def test_refuses_to_rerun_against_a_build_that_carries_no_model():
    with pytest.raises(ArtifactError, match="no model is present"):
        reproduce(document(FEATURES, 0.5), {"artifactVersion": 1, "present": False})


def test_an_older_document_still_shows_the_model_without_claiming_a_rerun():
    older = parse_report_document(
        {
            "documentVersion": 1,
            "report": {"serial": "7F2A-0091", "band": "mixed", "probability": 0.4},
        }
    )

    result = reproduce(older, artifact())

    assert result.probability is None
    assert not result.agrees
    assert "cannot be run again" in result.problems[0]


def test_a_document_missing_a_feature_with_no_sketch_names_it():
    features = {"ratingDeconvolution.injectedShare": None, "temporalBurst.burstFraction": 0.6}

    result = reproduce(document(features, 0.5), artifact())

    assert result.probability is None
    assert "ratingDeconvolution.injectedShare" in result.problems[0]


def test_calibration_is_applied_the_way_the_extension_applies_it():
    calibrated = artifact(calibration=[{"x": 0.0, "y": 0.1}, {"x": 1.0, "y": 0.9}])
    model = CombinerModel(
        intercept=-1.0,
        coefficients=dict(COEFFICIENTS),
        calibration=[CalibrationPoint(0.0, 0.1), CalibrationPoint(1.0, 0.9)],
        feature_quantiles={k: list(v) for k, v in QUANTILES.items()},
    )
    scored = score_features(model, dict(FEATURES), impute=MEDIAN_FRACTION)
    assert isinstance(scored, CombinerOk)

    result = reproduce(document(FEATURES, scored.probability), calibrated)

    assert result.agrees
