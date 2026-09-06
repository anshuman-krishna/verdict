import pytest

from verdict_research.corpus.labeling import (
    ABSTAIN,
    NEGATIVE,
    POSITIVE,
    LabelingFunction,
    apply_labeling_functions,
    labeling_function_stats,
    majority_vote,
    weak_labels,
)

# the functions here are deliberately meaningless: they read a made up
# field and vote on it. What a real labelling function says about a listing
# is anshuman's to decide, and these exist only to drive the
# mechanics.


def votes_on(key: str, threshold: float) -> LabelingFunction:
    def vote(features):
        value = features.get(key)
        if value is None:
            return ABSTAIN
        return POSITIVE if value > threshold else NEGATIVE

    return LabelingFunction(name=f"{key}_over_{threshold}", vote=vote)


class TestApplyLabelingFunctions:
    def test_builds_one_row_per_example_and_one_column_per_function(self):
        rows = [{"a": 1.0}, {"a": 0.0}, {"a": None}]
        matrix = apply_labeling_functions(rows, [votes_on("a", 0.5), votes_on("a", -1.0)])
        assert matrix == [
            [POSITIVE, POSITIVE],
            [NEGATIVE, POSITIVE],
            [ABSTAIN, ABSTAIN],
        ]

    # a set of functions is developed incrementally, and one half written
    # function should not cost the whole matrix.
    def test_a_function_that_raises_abstains_rather_than_aborting_the_run(self):
        def explode(features):
            raise ValueError("not finished yet")

        matrix = apply_labeling_functions(
            [{"a": 1.0}], [LabelingFunction(name="explode", vote=explode), votes_on("a", 0.5)]
        )
        assert matrix == [[ABSTAIN, POSITIVE]]

    def test_a_vote_outside_the_three_allowed_values_is_treated_as_abstaining(self):
        matrix = apply_labeling_functions(
            [{"a": 1.0}], [LabelingFunction(name="nonsense", vote=lambda features: 7)]
        )
        assert matrix == [[ABSTAIN]]


class TestLabelingFunctionStats:
    def test_measures_coverage_overlap_and_conflict(self):
        # first function votes on three of four, second on two of four, and
        # they disagree on exactly one of the two they share.
        matrix = [
            [POSITIVE, POSITIVE],
            [POSITIVE, NEGATIVE],
            [NEGATIVE, ABSTAIN],
            [ABSTAIN, ABSTAIN],
        ]
        functions = [votes_on("a", 0.5), votes_on("b", 0.5)]
        first, second = labeling_function_stats(matrix, functions)

        assert first.coverage == 0.75
        assert first.overlap == 0.5
        assert first.conflict == 0.25
        assert second.coverage == 0.5
        assert second.overlap == 0.5
        assert second.conflict == 0.25

    # the reason these statistics exist: a function with high coverage and
    # chance accuracy is worse than no function at all.
    def test_measures_accuracy_against_the_labelled_seed(self):
        matrix = [[POSITIVE], [POSITIVE], [NEGATIVE], [ABSTAIN]]
        stats = labeling_function_stats(matrix, [votes_on("a", 0.5)], gold_labels=[1, 0, 0, 1])
        assert stats[0].empirical_accuracy == pytest.approx(2 / 3)

    def test_ignores_unlabelled_examples_when_measuring_accuracy(self):
        matrix = [[POSITIVE], [POSITIVE]]
        stats = labeling_function_stats(matrix, [votes_on("a", 0.5)], gold_labels=[1, None])
        assert stats[0].empirical_accuracy == 1.0

    # never voting on a labelled example is not the same as being wrong,
    # and reporting it as zero would read as the opposite of the truth.
    def test_reports_no_accuracy_rather_than_zero_when_it_never_votes_on_a_label(self):
        matrix = [[ABSTAIN], [ABSTAIN]]
        stats = labeling_function_stats(matrix, [votes_on("a", 0.5)], gold_labels=[1, 0])
        assert stats[0].empirical_accuracy is None

    def test_reports_no_accuracy_when_no_seed_labels_are_given(self):
        stats = labeling_function_stats([[POSITIVE]], [votes_on("a", 0.5)])
        assert stats[0].empirical_accuracy is None

    def test_handles_an_empty_corpus_without_dividing_by_zero(self):
        stats = labeling_function_stats([], [votes_on("a", 0.5)])
        assert stats[0].coverage == 0.0
        assert stats[0].overlap == 0.0
        assert stats[0].conflict == 0.0


class TestMajorityVote:
    def test_takes_the_majority(self):
        assert majority_vote([POSITIVE, POSITIVE, NEGATIVE]).label == POSITIVE
        assert majority_vote([NEGATIVE, NEGATIVE, POSITIVE]).label == NEGATIVE

    # SPEC.md section 6's rule: an example the functions disagree evenly
    # about is not a training example, and a tiebreak here would encode a
    # preference nothing measured.
    def test_abstains_on_a_tie(self):
        assert majority_vote([POSITIVE, NEGATIVE]).label == ABSTAIN

    def test_abstains_when_nothing_voted(self):
        assert majority_vote([ABSTAIN, ABSTAIN]).label == ABSTAIN
        assert majority_vote([]).label == ABSTAIN

    def test_carries_the_vote_counts_so_a_weak_label_can_be_filtered_on_them(self):
        result = majority_vote([POSITIVE, POSITIVE, NEGATIVE, ABSTAIN])
        assert (result.positive_votes, result.negative_votes) == (2, 1)

    def test_weak_labels_reduces_a_whole_matrix(self):
        matrix = [[POSITIVE, POSITIVE], [POSITIVE, NEGATIVE], [NEGATIVE, ABSTAIN]]
        assert [label.label for label in weak_labels(matrix)] == [POSITIVE, ABSTAIN, NEGATIVE]
