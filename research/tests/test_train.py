from verdict_research.model.combine import CalibrationPoint, CombinerModel
from verdict_research.model.train import (
    export_model,
    fit_isotonic_regression,
    fit_logistic_regression,
    model_from_json,
    model_to_json,
    predict_probability,
)


class TestFitIsotonicRegression:
    def test_hand_computed_the_textbook_pava_example(self):
        # x = 0..5, y = [1, 2, 1, 3, 2, 4]. worked by hand in the session
        # notes via the pool adjacent violators algorithm, and matches the
        # standard textbook result for this exact sequence.
        pairs = list(zip(range(6), [1, 2, 1, 3, 2, 4], strict=True))
        result = fit_isotonic_regression(pairs)
        assert [p.y for p in result] == [1, 1.5, 1.5, 2.5, 2.5, 4]
        assert [p.x for p in result] == [0, 1, 2, 3, 4, 5]

    def test_already_monotonic_input_is_unchanged(self):
        pairs = [(0.0, 0.1), (1.0, 0.4), (2.0, 0.6), (3.0, 0.9)]
        result = fit_isotonic_regression(pairs)
        assert [p.y for p in result] == [0.1, 0.4, 0.6, 0.9]

    def test_merges_duplicate_x_by_weighted_average_before_pooling(self):
        pairs = [(0.0, 0.0), (0.0, 1.0), (1.0, 0.5)]
        result = fit_isotonic_regression(pairs)
        assert [(p.x, p.y) for p in result] == [(0.0, 0.5), (1.0, 0.5)]

    def test_empty_input_returns_empty_output(self):
        assert fit_isotonic_regression([]) == []

    def test_output_is_always_non_decreasing(self):
        pairs = list(zip(range(8), [5, 1, 4, 2, 6, 3, 7, 0], strict=True))
        result = fit_isotonic_regression(pairs)
        values = [p.y for p in result]
        assert values == sorted(values)


class TestFitLogisticRegression:
    def test_learns_the_correct_coefficient_sign_on_a_separable_feature(self):
        rows = [{"x": -3.0}, {"x": -2.0}, {"x": -1.0}, {"x": 1.0}, {"x": 2.0}, {"x": 3.0}]
        labels = [0, 0, 0, 1, 1, 1]
        fit = fit_logistic_regression(rows, labels, ["x"], iterations=500, l2=0.01)
        assert fit.coefficients["x"] > 0

    def test_confidently_separates_a_clearly_separable_dataset(self):
        rows = [{"x": -3.0}, {"x": -2.0}, {"x": -1.0}, {"x": 1.0}, {"x": 2.0}, {"x": 3.0}]
        labels = [0, 0, 0, 1, 1, 1]
        fit = fit_logistic_regression(rows, labels, ["x"], iterations=1000, l2=0.01)
        assert predict_probability(fit, {"x": 3.0}) > 0.9
        assert predict_probability(fit, {"x": -3.0}) < 0.1

    def test_raises_on_mismatched_row_and_label_counts(self):
        try:
            fit_logistic_regression([{"x": 1.0}], [0, 1], ["x"])
            raise AssertionError("expected a ValueError")
        except ValueError:
            pass

    def test_raises_on_no_rows(self):
        try:
            fit_logistic_regression([], [], ["x"])
            raise AssertionError("expected a ValueError")
        except ValueError:
            pass


class TestExportAndJsonRoundTrip:
    def test_export_model_assembles_fit_and_calibration(self):
        from verdict_research.model.train import LogisticFit

        fit = LogisticFit(intercept=-1.0, coefficients={"x": 2.0})
        calibration = [CalibrationPoint(x=0.0, y=0.1), CalibrationPoint(x=1.0, y=0.9)]
        model = export_model(fit, calibration)
        assert model == CombinerModel(
            intercept=-1.0, coefficients={"x": 2.0}, calibration=calibration
        )

    def test_model_to_json_matches_the_extension_side_shape(self):
        model = CombinerModel(
            intercept=-1.0,
            coefficients={"ratingDeconvolution.injectedShare": 2.0},
            calibration=[CalibrationPoint(x=0.0, y=0.1)],
        )
        assert model_to_json(model) == {
            "intercept": -1.0,
            "coefficients": {"ratingDeconvolution.injectedShare": 2.0},
            "calibration": [{"x": 0.0, "y": 0.1}],
        }

    def test_json_round_trips_through_model_from_json(self):
        model = CombinerModel(
            intercept=-1.0,
            coefficients={"x": 2.0},
            calibration=[CalibrationPoint(x=0.0, y=0.1), CalibrationPoint(x=1.0, y=0.9)],
        )
        assert model_from_json(model_to_json(model)) == model
