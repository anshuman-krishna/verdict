import math

import pytest

from verdict_research.corpus.dataset import LabeledExample
from verdict_research.eval.report import evaluate_model, predict_probability
from verdict_research.model.combine import CalibrationPoint, CombinerModel


def sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


MODEL = CombinerModel(intercept=0.0, coefficients={"x": 4.0}, calibration=[])


class TestPredictProbability:
    def test_hand_computed_matches_a_plain_sigmoid_with_no_calibration(self):
        assert predict_probability(MODEL, {"x": 1.0}) == pytest.approx(sigmoid(4.0))

    def test_returns_none_when_a_required_feature_is_missing(self):
        assert predict_probability(MODEL, {}) is None

    def test_returns_none_when_a_required_feature_is_explicitly_null(self):
        assert predict_probability(MODEL, {"x": None}) is None

    def test_applies_calibration_when_the_model_has_a_curve(self):
        calibrated = CombinerModel(
            intercept=0.0,
            coefficients={"x": 4.0},
            calibration=[CalibrationPoint(x=0.0, y=0.5), CalibrationPoint(x=1.0, y=0.5)],
        )
        # the calibration curve is flat at 0.5 everywhere, so no matter
        # what the raw sigmoid says, the calibrated output is 0.5
        assert predict_probability(calibrated, {"x": 100.0}) == pytest.approx(0.5)


class TestEvaluateModel:
    def test_hand_computed_precision_recall_and_f1_at_the_default_threshold(self):
        examples = [
            LabeledExample(example_id="tp", features={"x": 1.0}, label=1),
            LabeledExample(example_id="tn", features={"x": -1.0}, label=0),
            LabeledExample(example_id="fp", features={"x": 0.1}, label=0),
            LabeledExample(example_id="fn", features={"x": -0.1}, label=1),
        ]
        report = evaluate_model(MODEL, examples)

        assert report.evaluated_count == 4
        assert report.skipped_missing_features_count == 0
        assert report.precision_at_default_threshold == pytest.approx(0.5)
        assert report.recall_at_default_threshold == pytest.approx(0.5)
        assert report.f1_at_default_threshold == pytest.approx(0.5)
        assert 0.0 <= report.expected_calibration_error <= 1.0
        assert len(report.curve) == 4

    def test_hand_computed_expected_calibration_error(self):
        examples = [
            LabeledExample(example_id="tp", features={"x": 1.0}, label=1),
            LabeledExample(example_id="tn", features={"x": -1.0}, label=0),
            LabeledExample(example_id="fp", features={"x": 0.1}, label=0),
            LabeledExample(example_id="fn", features={"x": -0.1}, label=1),
        ]
        report = evaluate_model(MODEL, examples)

        probs = [sigmoid(4.0), sigmoid(-4.0), sigmoid(0.4), sigmoid(-0.4)]
        labels = [1, 0, 0, 1]
        bins = [min(9, max(0, int(p * 10))) for p in probs]
        assert len(set(bins)) == 4  # each lands in its own bin, so each term is |p - label|
        expected = sum(abs(p - label) for p, label in zip(probs, labels, strict=True)) / 4
        assert report.expected_calibration_error == pytest.approx(expected)

    def test_examples_missing_the_model_features_are_skipped_not_counted_as_wrong(self):
        examples = [
            LabeledExample(example_id="ok", features={"x": 1.0}, label=1),
            LabeledExample(example_id="missing", features={}, label=1),
        ]
        report = evaluate_model(MODEL, examples)
        assert report.evaluated_count == 1
        assert report.skipped_missing_features_count == 1

    def test_no_evaluable_examples_returns_none_metrics_rather_than_dividing_by_zero(self):
        examples = [LabeledExample(example_id="missing", features={}, label=1)]
        report = evaluate_model(MODEL, examples)
        assert report.evaluated_count == 0
        assert report.skipped_missing_features_count == 1
        assert report.precision_at_default_threshold is None
        assert report.recall_at_default_threshold is None
        assert report.f1_at_default_threshold is None
        assert report.expected_calibration_error == 0.0
        assert report.curve == []

    def test_a_custom_decision_threshold_changes_the_headline_confusion_counts(self):
        # sigmoid(0.4) ~= 0.599: a single actual positive predicted
        # positive at the lenient default threshold, predicted negative
        # once the threshold is raised above it.
        examples = [LabeledExample(example_id="a", features={"x": 0.1}, label=1)]

        lenient = evaluate_model(MODEL, examples, decision_threshold=0.5)
        assert lenient.precision_at_default_threshold == pytest.approx(1.0)
        assert lenient.recall_at_default_threshold == pytest.approx(1.0)

        strict = evaluate_model(MODEL, examples, decision_threshold=0.7)
        assert strict.precision_at_default_threshold is None  # no predicted positives at all
        assert strict.recall_at_default_threshold == pytest.approx(0.0)
