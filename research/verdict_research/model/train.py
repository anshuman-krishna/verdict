import math
from dataclasses import dataclass

from verdict_research.model.combine import CalibrationPoint, CombinerModel


@dataclass
class LogisticFit:
    intercept: float
    coefficients: dict[str, float]


def _dot(coefficients: dict[str, float], row: dict[str, float], feature_names: list[str]) -> float:
    return sum(coefficients[name] * row[name] for name in feature_names)


def _sigmoid(x: float) -> float:
    if x >= 0:
        return 1 / (1 + math.exp(-x))
    e = math.exp(x)
    return e / (1 + e)


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
    x: float
    y_sum: float
    weight: float
    count: int

    @property
    def mean(self) -> float:
        return self.y_sum / self.weight


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

    points: list[CalibrationPoint] = []
    x_iter = iter(xs)
    for block in blocks:
        for _ in range(block.count):
            points.append(CalibrationPoint(x=next(x_iter), y=block.mean))
    return points


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
