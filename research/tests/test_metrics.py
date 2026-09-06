import pytest

from verdict_research.eval.metrics import (
    ConfusionCounts,
    confusion_counts,
    expected_calibration_error,
    f1_score,
    precision,
    precision_recall_curve,
    recall,
)


class TestConfusionCounts:
    def test_hand_computed(self):
        y_true = [1, 1, 1, 0, 0, 0]
        y_pred = [1, 1, 0, 1, 0, 0]
        counts = confusion_counts(y_true, y_pred)
        assert counts == ConfusionCounts(
            true_positive=2, false_positive=1, true_negative=2, false_negative=1
        )

    def test_raises_on_mismatched_lengths(self):
        try:
            confusion_counts([1], [1, 0])
            raise AssertionError("expected a ValueError")
        except ValueError:
            pass


class TestPrecisionRecallF1:
    def test_hand_computed(self):
        counts = ConfusionCounts(
            true_positive=2, false_positive=1, true_negative=2, false_negative=1
        )
        assert precision(counts) == 2 / 3
        assert recall(counts) == 2 / 3
        assert f1_score(counts) == 2 / 3

    def test_precision_is_none_with_no_predicted_positives(self):
        counts = ConfusionCounts(
            true_positive=0, false_positive=0, true_negative=5, false_negative=3
        )
        assert precision(counts) is None
        assert f1_score(counts) is None

    def test_recall_is_none_with_no_actual_positives(self):
        counts = ConfusionCounts(
            true_positive=0, false_positive=2, true_negative=5, false_negative=0
        )
        assert recall(counts) is None


class TestPrecisionRecallCurve:
    def test_recall_never_increases_as_the_threshold_rises(self):
        y_true = [1, 1, 1, 0, 0]
        y_score = [0.9, 0.6, 0.4, 0.3, 0.1]
        points = precision_recall_curve(y_true, y_score)
        recalls = [p.recall for p in points]
        assert recalls == sorted(recalls, reverse=True)

    def test_the_lowest_threshold_predicts_everything_positive(self):
        y_true = [1, 0, 1]
        y_score = [0.9, 0.5, 0.1]
        points = precision_recall_curve(y_true, y_score)
        lowest = min(points, key=lambda p: p.threshold)
        assert lowest.recall == 1.0

    def test_raises_on_mismatched_lengths(self):
        try:
            precision_recall_curve([1], [0.5, 0.6])
            raise AssertionError("expected a ValueError")
        except ValueError:
            pass


class TestExpectedCalibrationError:
    def test_hand_computed_two_bin_example(self):
        # worked by hand: bin [0, 0.5) holds 0.2 and
        # 0.3 (mean 0.25, true labels 0 and 1, fraction positive 0.5),
        # bin [0.5, 1.0] holds 0.7 and 0.9 (mean 0.8, both labelled 1,
        # fraction positive 1.0). ece = 0.5*|0.25-0.5| + 0.5*|0.8-1.0|
        # = 0.125 + 0.1 = 0.225.
        y_true = [0, 1, 1, 1]
        y_prob = [0.2, 0.3, 0.7, 0.9]
        assert expected_calibration_error(y_true, y_prob, bins=2) == pytest.approx(0.225)

    def test_perfect_calibration_is_zero(self):
        y_true = [0, 0, 1, 1]
        y_prob = [0.0, 0.0, 1.0, 1.0]
        assert expected_calibration_error(y_true, y_prob, bins=2) == 0.0

    def test_empty_input_is_zero_rather_than_dividing_by_zero(self):
        assert expected_calibration_error([], [], bins=10) == 0.0

    def test_raises_on_mismatched_lengths(self):
        try:
            expected_calibration_error([1], [0.5, 0.6])
            raise AssertionError("expected a ValueError")
        except ValueError:
            pass
