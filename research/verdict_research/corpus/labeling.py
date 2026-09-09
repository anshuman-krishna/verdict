from collections.abc import Callable, Sequence
from dataclasses import dataclass

ABSTAIN = -1
NEGATIVE = 0
POSITIVE = 1

Features = dict[str, float | None]
Vote = int


@dataclass(frozen=True)
class LabelingFunction:
    name: str
    vote: Callable[[Features], Vote]


def apply_labeling_functions(
    rows: Sequence[Features], functions: Sequence[LabelingFunction]
) -> list[list[Vote]]:
    matrix = []
    for row in rows:
        votes = []
        for function in functions:
            try:
                vote = function.vote(row)
            except Exception:  # noqa: BLE001 - a broken function abstains, it does not abort the run
                vote = ABSTAIN
            votes.append(vote if vote in (POSITIVE, NEGATIVE) else ABSTAIN)
        matrix.append(votes)
    return matrix


@dataclass(frozen=True)
class LabelingFunctionStats:
    name: str
    coverage: float
    overlap: float
    conflict: float
    empirical_accuracy: float | None


def _column(matrix: Sequence[Sequence[Vote]], index: int) -> list[Vote]:
    return [row[index] for row in matrix]


def labeling_function_stats(
    matrix: Sequence[Sequence[Vote]],
    functions: Sequence[LabelingFunction],
    gold_labels: Sequence[int | None] | None = None,
) -> list[LabelingFunctionStats]:
    total = len(matrix)
    stats = []
    for index, function in enumerate(functions):
        votes = _column(matrix, index)
        voted = [row_index for row_index, vote in enumerate(votes) if vote != ABSTAIN]

        overlapping = 0
        conflicting = 0
        for row_index in voted:
            others = [
                vote
                for other_index, vote in enumerate(matrix[row_index])
                if other_index != index and vote != ABSTAIN
            ]
            if others:
                overlapping += 1
            if any(vote != votes[row_index] for vote in others):
                conflicting += 1

        accuracy: float | None = None
        if gold_labels is not None:
            judged = [
                row_index
                for row_index in voted
                if row_index < len(gold_labels) and gold_labels[row_index] is not None
            ]
            if judged:
                correct = sum(
                    1 for row_index in judged if votes[row_index] == gold_labels[row_index]
                )
                accuracy = correct / len(judged)

        stats.append(
            LabelingFunctionStats(
                name=function.name,
                coverage=len(voted) / total if total else 0.0,
                overlap=overlapping / total if total else 0.0,
                conflict=conflicting / total if total else 0.0,
                empirical_accuracy=accuracy,
            )
        )
    return stats


@dataclass(frozen=True)
class WeakLabel:
    label: int
    positive_votes: int
    negative_votes: int


def majority_vote(votes: Sequence[Vote]) -> WeakLabel:
    positive = sum(1 for vote in votes if vote == POSITIVE)
    negative = sum(1 for vote in votes if vote == NEGATIVE)
    if positive > negative:
        label = POSITIVE
    elif negative > positive:
        label = NEGATIVE
    else:
        label = ABSTAIN
    return WeakLabel(label=label, positive_votes=positive, negative_votes=negative)


def weak_labels(matrix: Sequence[Sequence[Vote]]) -> list[WeakLabel]:
    return [majority_vote(votes) for votes in matrix]
