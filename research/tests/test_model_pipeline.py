import pytest

from verdict_research.corpus.dataset import LabeledExample
from verdict_research.eval.metrics import ThresholdPoint
from verdict_research.model.pipeline import (
    MINIMUM_RECALL,
    acceptance_problems,
    acceptance_summary,
    best_operating_point,
    train_pipeline,
)

# synthetic examples, built to exercise the pipeline's ordering and its
# refusals. They are not a corpus and carry no claim about any real listing:
# SPEC.md section 12's corpus and its labels are anshuman's.


def example(index: int, signal: float, label: int, *, missing: bool = False) -> LabeledExample:
    return LabeledExample(
        example_id=str(index),
        features={"signal": None if missing else signal, "noise": 0.5},
        label=label,
    )


def separable_corpus(count: int = 200) -> list[LabeledExample]:
    return [
        example(index, 0.9 if index % 2 == 0 else 0.1, 1 if index % 2 == 0 else 0)
        for index in range(count)
    ]


def test_pipeline_splits_three_ways_and_never_evaluates_on_training_rows():
    run = train_pipeline(separable_corpus(), ["signal"], seed=7)
    sizes = run.sizes
    assert sizes.train + sizes.calibration + sizes.test == 200
    assert sizes.test == 40
    assert run.report.evaluated_count <= sizes.test


def test_pipeline_requires_a_feature_choice_rather_than_inventing_one():
    with pytest.raises(ValueError, match="feature_names"):
        train_pipeline(separable_corpus(), [])


def test_rows_missing_a_chosen_feature_are_dropped_not_imputed():
    corpus = separable_corpus(100)
    corpus[0] = example(0, 0.9, 1, missing=True)
    corpus[2] = example(2, 0.9, 1, missing=True)
    run = train_pipeline(corpus, ["signal"], seed=3)
    assert run.sizes.dropped_incomplete >= 1


def test_pipeline_refuses_a_corpus_with_no_complete_training_row():
    corpus = [example(index, 0.9, index % 2, missing=True) for index in range(50)]
    with pytest.raises(ValueError, match="every chosen feature"):
        train_pipeline(corpus, ["signal"], seed=1)


def test_the_same_seed_produces_the_same_model():
    first = train_pipeline(separable_corpus(), ["signal"], seed=11)
    second = train_pipeline(separable_corpus(), ["signal"], seed=11)
    assert first.model == second.model


def test_a_separable_corpus_reaches_the_section_14_operating_point():
    run = train_pipeline(separable_corpus(400), ["signal"], seed=5)
    assert run.operating_point is not None
    assert run.operating_point.precision > 0.80
    assert run.operating_point.recall > MINIMUM_RECALL


def test_acceptance_summary_reports_what_was_measured():
    run = train_pipeline(separable_corpus(400), ["signal"], seed=5)
    summary = acceptance_summary(run)
    assert summary["featureNames"] == ["signal"]
    assert summary["testCount"] == 80
    assert summary["meetsCriteria"] == (not acceptance_problems(run))


def test_acceptance_problems_names_each_unmet_criterion():
    # a corpus with no relationship between the feature and the label
    noise = [example(index, 0.5, index % 2) for index in range(200)]
    run = train_pipeline(noise, ["signal"], seed=2)
    problems = acceptance_problems(run)
    assert problems
    assert all(isinstance(problem, str) for problem in problems)


class TestBestOperatingPoint:
    def test_picks_the_strongest_precision_above_the_recall_floor(self):
        curve = [
            ThresholdPoint(threshold=0.1, precision=0.60, recall=0.99),
            ThresholdPoint(threshold=0.4, precision=0.85, recall=0.70),
            ThresholdPoint(threshold=0.9, precision=0.99, recall=0.10),
        ]
        point = best_operating_point(curve)
        assert point is not None
        assert point.threshold == 0.4

    def test_returns_none_when_no_threshold_reaches_the_floor(self):
        curve = [ThresholdPoint(threshold=0.9, precision=0.99, recall=0.10)]
        assert best_operating_point(curve) is None

    def test_ignores_thresholds_with_an_undefined_precision(self):
        curve = [ThresholdPoint(threshold=0.9, precision=None, recall=0.90)]
        assert best_operating_point(curve) is None
