import math
from dataclasses import dataclass

from verdict_research.corpus.dataset import LabeledExample
from verdict_research.eval.metrics import (
    ThresholdPoint,
    confusion_counts,
    expected_calibration_error,
    f1_score,
    precision,
    precision_recall_curve,
    recall,
)
from verdict_research.model.combine import CombinerModel, apply_calibration

# PLAN.md week 5: "model trained, calibrated, exported, evaluated." Ties
# together corpus/dataset.py's stored examples, model/train.py's fitted
# model, and this package's metrics.py into the one report SPEC.md
# section 14's acceptance criteria (precision, recall, expected
# calibration error) and the method page's "how well it works" section
# both need. Never sees a label's meaning or a corpus's provenance, only
# already labelled examples handed to it.


def _sigmoid(x: float) -> float:
    if x >= 0:
        return 1 / (1 + math.exp(-x))
    e = math.exp(x)
    return e / (1 + e)


# mirrors combine.py's apply_model, but starting from an already flat
# feature dict (LabeledExample.features) rather than a FeatureVector,
# since a stored example has no raw reviews to rebuild one from. Returns
# None, never a guess, when a coefficient the model needs is missing or
# null, the same "never confident on thin data" rule apply_model follows.
def predict_probability(model: CombinerModel, features: dict[str, float | None]) -> float | None:
    missing = [key for key in model.coefficients if features.get(key) is None]
    if missing:
        return None
    linear = model.intercept + sum(
        model.coefficients[key] * features[key]
        for key in model.coefficients  # type: ignore[operator]
    )
    return apply_calibration(model.calibration, _sigmoid(linear))


# SPEC.md section 14's own criterion is "precision above 0.80 at recall
# above 0.50", a point on the curve, not a fixed cutoff; 0.5 here is only
# a conventional default for this report's single headline row, and
# `curve` carries every threshold so the actual operating point SPEC.md
# describes can be read off it directly.
DEFAULT_DECISION_THRESHOLD = 0.5


@dataclass
class EvalReport:
    evaluated_count: int
    skipped_missing_features_count: int
    precision_at_default_threshold: float | None
    recall_at_default_threshold: float | None
    f1_at_default_threshold: float | None
    expected_calibration_error: float
    curve: list[ThresholdPoint]


def evaluate_model(
    model: CombinerModel,
    examples: list[LabeledExample],
    decision_threshold: float = DEFAULT_DECISION_THRESHOLD,
    calibration_bins: int = 10,
) -> EvalReport:
    y_true: list[int] = []
    y_prob: list[float] = []
    skipped = 0
    for example in examples:
        probability = predict_probability(model, example.features)
        if probability is None:
            skipped += 1
            continue
        y_true.append(example.label)
        y_prob.append(probability)

    if not y_true:
        return EvalReport(
            evaluated_count=0,
            skipped_missing_features_count=skipped,
            precision_at_default_threshold=None,
            recall_at_default_threshold=None,
            f1_at_default_threshold=None,
            expected_calibration_error=0.0,
            curve=[],
        )

    y_pred = [1 if p >= decision_threshold else 0 for p in y_prob]
    counts = confusion_counts(y_true, y_pred)

    return EvalReport(
        evaluated_count=len(y_true),
        skipped_missing_features_count=skipped,
        precision_at_default_threshold=precision(counts),
        recall_at_default_threshold=recall(counts),
        f1_at_default_threshold=f1_score(counts),
        expected_calibration_error=expected_calibration_error(
            y_true, y_prob, bins=calibration_bins
        ),
        curve=precision_recall_curve(y_true, y_prob),
    )
