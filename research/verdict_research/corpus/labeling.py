from collections.abc import Callable, Sequence
from dataclasses import dataclass

# SPEC.md section 12.4's mechanical half only. no labelling functions live here: each one is a claim
# about what makes a listing manipulated, and those are anshuman's.
# the statistics matter more than the aggregator: high coverage with chance accuracy is worse than
# no function at all, and measuring against the seed is the only way to see that first

ABSTAIN = -1
NEGATIVE = 0
POSITIVE = 1

Features = dict[str, float | None]
Vote = int


@dataclass(frozen=True)
class LabelingFunction:
    name: str
    # abstaining is correct whenever the feature a function reads is missing, which is common
    vote: Callable[[Features], Vote]


# a function that raises abstains rather than aborting: one half written function is not the matrix
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
    # share of examples this function votes on at all
    coverage: float
    # share of examples where it votes and at least one other function also
    # votes, which is what makes its agreement measurable
    overlap: float
    # share of examples where it votes and another function votes the
    # opposite way
    conflict: float
    # None when it never votes on a labelled example, which is not the same as being wrong
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


# ties abstain: a tiebreak would encode a preference between functions that nothing measured.
# unweighted until there are real functions and a seed to fit weights on
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
