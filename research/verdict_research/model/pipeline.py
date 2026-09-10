from dataclasses import dataclass

from verdict_research.corpus.dataset import LabeledExample, train_test_split
from verdict_research.eval.metrics import ThresholdPoint
from verdict_research.eval.report import EvalReport, evaluate_model
from verdict_research.model.combine import MEDIAN_FRACTION, CombinerModel
from verdict_research.model.train import (
    LogisticFit,
    export_model,
    feature_quantiles,
    fit_isotonic_regression,
    fit_logistic_regression,
    predict_probability,
)

MINIMUM_PRECISION = 0.80
MINIMUM_RECALL = 0.50
MAXIMUM_EXPECTED_CALIBRATION_ERROR = 0.05


@dataclass(frozen=True)
class OperatingPoint:
    threshold: float
    precision: float
    recall: float


def best_operating_point(
    curve: list[ThresholdPoint], minimum_recall: float = MINIMUM_RECALL
) -> OperatingPoint | None:
    eligible = [
        OperatingPoint(threshold=point.threshold, precision=point.precision, recall=point.recall)
        for point in curve
        if point.recall is not None
        and point.precision is not None
        and point.recall > minimum_recall
    ]
    if not eligible:
        return None
    return max(eligible, key=lambda point: (point.precision, point.recall))


@dataclass(frozen=True)
class SplitSizes:
    train: int
    calibration: int
    test: int
    dropped_incomplete: int


@dataclass(frozen=True)
class TrainingRun:
    model: CombinerModel
    fit: LogisticFit
    report: EvalReport
    operating_point: OperatingPoint | None
    sizes: SplitSizes
    feature_names: list[str]


def _complete_rows(
    examples: list[LabeledExample], feature_names: list[str]
) -> tuple[list[dict[str, float]], list[int], int]:
    rows: list[dict[str, float]] = []
    labels: list[int] = []
    dropped = 0
    for example in examples:
        values = {name: example.features.get(name) for name in feature_names}
        if any(value is None for value in values.values()):
            dropped += 1
            continue
        rows.append({name: float(value) for name, value in values.items() if value is not None})
        labels.append(example.label)
    return rows, labels, dropped


def train_pipeline(
    examples: list[LabeledExample],
    feature_names: list[str],
    *,
    test_fraction: float = 0.2,
    calibration_fraction: float = 0.25,
    seed: int = 0,
    learning_rate: float = 0.1,
    iterations: int = 2000,
    l2: float = 0.0,
) -> TrainingRun:
    if not feature_names:
        raise ValueError(
            "feature_names is required: which features the model uses is not a default"
        )

    developing, held_out = train_test_split(examples, test_fraction=test_fraction, seed=seed)
    # calibrated off the development half only
    fitting, calibrating = train_test_split(
        developing, test_fraction=calibration_fraction, seed=seed + 1
    )

    fit_rows, fit_labels, dropped_fit = _complete_rows(fitting, feature_names)
    if not fit_rows:
        raise ValueError("no training row carries every chosen feature")
    fit = fit_logistic_regression(
        fit_rows,
        fit_labels,
        feature_names,
        learning_rate=learning_rate,
        iterations=iterations,
        l2=l2,
    )

    calibration_rows, calibration_labels, dropped_calibration = _complete_rows(
        calibrating, feature_names
    )
    pairs = [
        (predict_probability(fit, row), float(label))
        for row, label in zip(calibration_rows, calibration_labels, strict=True)
    ]
    model = export_model(
        fit, fit_isotonic_regression(pairs), feature_quantiles(fit_rows, feature_names)
    )

    report = evaluate_model(model, held_out, impute=MEDIAN_FRACTION)
    return TrainingRun(
        model=model,
        fit=fit,
        report=report,
        operating_point=best_operating_point(report.curve),
        sizes=SplitSizes(
            train=len(fit_rows),
            calibration=len(calibration_rows),
            test=len(held_out),
            dropped_incomplete=dropped_fit + dropped_calibration,
        ),
        feature_names=list(feature_names),
    )


def report_problems(report: EvalReport, point: OperatingPoint | None) -> list[str]:
    problems: list[str] = []
    if point is None:
        problems.append(f"no threshold reaches recall above {MINIMUM_RECALL}")
    elif point.precision <= MINIMUM_PRECISION:
        problems.append(
            f"precision {point.precision:.3f} at recall {point.recall:.3f} "
            f"does not clear {MINIMUM_PRECISION}"
        )
    if report.expected_calibration_error >= MAXIMUM_EXPECTED_CALIBRATION_ERROR:
        problems.append(
            f"expected calibration error {report.expected_calibration_error:.3f} "
            f"is not below {MAXIMUM_EXPECTED_CALIBRATION_ERROR}"
        )
    if report.evaluated_count == 0:
        problems.append("nothing in the held out set could be evaluated")
    return problems


def acceptance_problems(run: TrainingRun) -> list[str]:
    return report_problems(run.report, run.operating_point)


def acceptance_summary(run: TrainingRun) -> dict[str, object]:
    point = run.operating_point
    return {
        "meetsCriteria": not acceptance_problems(run),
        "decisionThreshold": None if point is None else point.threshold,
        "precision": None if point is None else point.precision,
        "recall": None if point is None else point.recall,
        "expectedCalibrationError": run.report.expected_calibration_error,
        "evaluatedCount": run.report.evaluated_count,
        "skippedMissingFeaturesCount": run.report.skipped_missing_features_count,
        "imputedCount": run.report.imputed_count,
        "trainCount": run.sizes.train,
        "calibrationCount": run.sizes.calibration,
        "testCount": run.sizes.test,
        "featureNames": list(run.feature_names),
    }
