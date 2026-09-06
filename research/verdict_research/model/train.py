import math
from dataclasses import dataclass

from verdict_research.model.combine import CalibrationPoint, CombinerModel

# SPEC.md section 6: "start with logistic regression on the feature
# vector... calibrate with isotonic regression on a held out slice." This
# module fits both, given rows the caller already flattened and labelled.
# It never decides what a positive label means, how the corpus was split,
# or which features belong in the model: those are exactly the reserved
# "label corpus and its methodology" and "the calibration target",
# reserved for anshuman. What is left, gradient descent on a logistic loss
# and the pool adjacent violators algorithm for isotonic regression, is
# generic numerical fitting with a single well known correct answer, not a
# judgement call, so it is safe to build ahead of the corpus that will
# eventually feed it.


@dataclass
class LogisticFit:
    intercept: float
    coefficients: dict[str, float]


def _dot(coefficients: dict[str, float], row: dict[str, float], feature_names: list[str]) -> float:
    return sum(coefficients[name] * row[name] for name in feature_names)


def _sigmoid(x: float) -> float:
    # avoids OverflowError on a very negative x; math.exp(-x) for a large
    # negative x is what would overflow, not the branch that is skipped.
    if x >= 0:
        return 1 / (1 + math.exp(-x))
    e = math.exp(x)
    return e / (1 + e)


# batch gradient descent on mean binary cross entropy, with optional L2
# weight decay to keep coefficients finite on separable data (plain,
# unregularised logistic regression has no finite optimum there, the
# weights simply grow without bound as the loss keeps shrinking).
def fit_logistic_regression(
    rows: list[dict[str, float]],
    labels: list[int],
    feature_names: list[str],
    *,
    learning_rate: float = 0.1,
    iterations: int = 2000,
    l2: float = 0.0,
) -> LogisticFit:
    if len(rows) != len(labels):
        raise ValueError("rows and labels must be the same length")
    if not rows:
        raise ValueError("fit_logistic_regression needs at least one row")

    intercept = 0.0
    coefficients = dict.fromkeys(feature_names, 0.0)
    n = len(rows)

    for _ in range(iterations):
        intercept_grad = 0.0
        coefficient_grads = dict.fromkeys(feature_names, 0.0)
        for row, label in zip(rows, labels, strict=True):
            linear = intercept + _dot(coefficients, row, feature_names)
            error = _sigmoid(linear) - label
            intercept_grad += error
            for name in feature_names:
                coefficient_grads[name] += error * row[name]

        intercept -= learning_rate * (intercept_grad / n)
        for name in feature_names:
            regularised = coefficient_grads[name] / n + l2 * coefficients[name]
            coefficients[name] -= learning_rate * regularised

    return LogisticFit(intercept=intercept, coefficients=coefficients)


def predict_probability(fit: LogisticFit, row: dict[str, float]) -> float:
    feature_names = list(fit.coefficients.keys())
    return _sigmoid(fit.intercept + _dot(fit.coefficients, row, feature_names))


@dataclass
class _Block:
    # a pooled run of one or more original, already x-deduplicated points.
    # weight is the PAVA averaging weight (duplicate y values at the same
    # x count more than once here); count is how many distinct x values
    # the block spans, which is what expansion back to output points needs
    # and is not the same number whenever a single x carried duplicate ys.
    x: float
    y_sum: float
    weight: float
    count: int

    @property
    def mean(self) -> float:
        return self.y_sum / self.weight


# pool adjacent violators, the standard algorithm for isotonic regression:
# https://en.wikipedia.org/wiki/Isotonic_regression#Pool_adjacent_violators_algorithm.
# ties on x are merged by weighted average before pooling, since PAVA
# expects a single y per x. Not itself specific to calibrating a
# probability, this is the exact algorithm SPEC.md section 6 names.
def fit_isotonic_regression(pairs: list[tuple[float, float]]) -> list[CalibrationPoint]:
    if not pairs:
        return []

    merged: dict[float, list[float]] = {}
    for x, y in pairs:
        merged.setdefault(x, []).append(y)
    xs = sorted(merged)

    blocks: list[_Block] = []
    for x in xs:
        values = merged[x]
        block = _Block(x=x, y_sum=sum(values), weight=float(len(values)), count=1)
        blocks.append(block)
        while len(blocks) >= 2 and blocks[-2].mean > blocks[-1].mean:
            last = blocks.pop()
            second_last = blocks.pop()
            blocks.append(
                _Block(
                    x=second_last.x,
                    y_sum=second_last.y_sum + last.y_sum,
                    weight=second_last.weight + last.weight,
                    count=second_last.count + last.count,
                )
            )

    # each block spans a run of the original, deduplicated xs; every x in
    # that run gets the block's pooled mean as its calibrated value.
    points: list[CalibrationPoint] = []
    x_iter = iter(xs)
    for block in blocks:
        for _ in range(block.count):
            points.append(CalibrationPoint(x=next(x_iter), y=block.mean))
    return points


# assembles a fitted model and a fitted calibration curve into the shape
# combine.py's apply_model (and extension/src/score/combine.ts's
# applyModel) already consume. Fitting the calibration curve against
# (raw_probability, label) pairs from a held out slice, per SPEC.md
# section 6, is the caller's job, since only the caller knows which rows
# were held out.
def export_model(fit: LogisticFit, calibration: list[CalibrationPoint]) -> CombinerModel:
    return CombinerModel(
        intercept=fit.intercept, coefficients=dict(fit.coefficients), calibration=calibration
    )


def model_to_json(model: CombinerModel) -> dict:
    return {
        "intercept": model.intercept,
        "coefficients": dict(model.coefficients),
        "calibration": [{"x": point.x, "y": point.y} for point in model.calibration],
    }


def model_from_json(data: dict) -> CombinerModel:
    return CombinerModel(
        intercept=data["intercept"],
        coefficients=dict(data["coefficients"]),
        calibration=[CalibrationPoint(x=point["x"], y=point["y"]) for point in data["calibration"]],
    )
