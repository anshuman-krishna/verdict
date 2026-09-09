from dataclasses import dataclass


@dataclass(frozen=True)
class ConfusionCounts:
    true_positive: int
    false_positive: int
    true_negative: int
    false_negative: int


def confusion_counts(y_true: list[int], y_pred: list[int]) -> ConfusionCounts:
    if len(y_true) != len(y_pred):
        raise ValueError("y_true and y_pred must be the same length")
    tp = fp = tn = fn = 0
    for actual, predicted in zip(y_true, y_pred, strict=True):
        if predicted == 1 and actual == 1:
            tp += 1
        elif predicted == 1 and actual == 0:
            fp += 1
        elif predicted == 0 and actual == 0:
            tn += 1
        else:
            fn += 1
    return ConfusionCounts(true_positive=tp, false_positive=fp, true_negative=tn, false_negative=fn)


def precision(counts: ConfusionCounts) -> float | None:
    denominator = counts.true_positive + counts.false_positive
    return counts.true_positive / denominator if denominator > 0 else None


def recall(counts: ConfusionCounts) -> float | None:
    denominator = counts.true_positive + counts.false_negative
    return counts.true_positive / denominator if denominator > 0 else None


def f1_score(counts: ConfusionCounts) -> float | None:
    p, r = precision(counts), recall(counts)
    if p is None or r is None or p + r == 0:
        return None
    return 2 * p * r / (p + r)


@dataclass(frozen=True)
class ThresholdPoint:
    threshold: float
    precision: float | None
    recall: float | None


def precision_recall_curve(y_true: list[int], y_score: list[float]) -> list[ThresholdPoint]:
    if len(y_true) != len(y_score):
        raise ValueError("y_true and y_score must be the same length")
    thresholds = sorted(set(y_score))
    points: list[ThresholdPoint] = []
    for threshold in thresholds:
        y_pred = [1 if score >= threshold else 0 for score in y_score]
        counts = confusion_counts(y_true, y_pred)
        points.append(
            ThresholdPoint(threshold=threshold, precision=precision(counts), recall=recall(counts))
        )
    return points


def expected_calibration_error(y_true: list[int], y_prob: list[float], bins: int = 10) -> float:
    if len(y_true) != len(y_prob):
        raise ValueError("y_true and y_prob must be the same length")
    if not y_true:
        return 0.0

    bucket_probs: list[list[float]] = [[] for _ in range(bins)]
    bucket_labels: list[list[int]] = [[] for _ in range(bins)]
    for actual, prob in zip(y_true, y_prob, strict=True):
        index = min(bins - 1, max(0, int(prob * bins)))
        bucket_probs[index].append(prob)
        bucket_labels[index].append(actual)

    total = len(y_true)
    error = 0.0
    for probs, labels in zip(bucket_probs, bucket_labels, strict=True):
        if not probs:
            continue
        mean_predicted = sum(probs) / len(probs)
        fraction_positive = sum(labels) / len(labels)
        error += (len(probs) / total) * abs(mean_predicted - fraction_positive)
    return error
