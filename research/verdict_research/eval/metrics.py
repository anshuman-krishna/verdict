from dataclasses import dataclass

# SPEC.md section 14's acceptance criteria for version 0.1: "held out
# precision above 0.80 at recall above 0.50 on the manipulated class" and
# "expected calibration error below 0.05". Both numbers are already fixed
# in SPEC.md, not something this module chooses; what is built here is the
# arithmetic that turns predictions and true labels into the figures those
# criteria are checked against. It never sees or produces a label itself,
# so it does not touch the reserved label corpus and methodology.


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


# None rather than 0.0 when the denominator is zero (no predicted
# positives, or no actual positives): "no precision computed" and "zero
# precision" are different facts, and SPEC.md section 6's rule applies
# here as much as it does to a signal with too little data.
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


# sweeps every distinct score as a decision threshold (predict 1 when
# score >= threshold), sorted from the most permissive to the strictest,
# which is the shape a precision/recall or "precision at recall X" chart
# needs. SPEC.md section 14's own criterion, precision at a given recall
# floor, is one row of this table, not a separate calculation.
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


# equal width binned expected calibration error: within each of `bins`
# equal width buckets of predicted probability, compares the bucket's mean
# predicted probability against the actual fraction of positives it
# contained, and averages that gap across buckets weighted by how many
# predictions fell in each. SPEC.md sections 6 and 14 name this exact
# metric and this exact acronym.
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
