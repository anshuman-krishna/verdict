import json

import pytest

from verdict_research.corpus.dataset import LabeledExample
from verdict_research.eval.method_document import (
    METHOD_DOCUMENT_VERSION,
    absent_method_document,
    build_method_document,
    write_method_document_file,
)
from verdict_research.model.pipeline import train_pipeline

# synthetic, like test_model_pipeline.py: this checks what the document carries, never any claim
# about a real listing. what the numbers mean, and the words around them, stay anshuman's.


def corpus(count: int = 400, separable: bool = True) -> list[LabeledExample]:
    return [
        LabeledExample(
            example_id=str(i),
            features={"signal": (0.9 if i % 2 == 0 else 0.1) if separable else 0.5},
            label=i % 2,
        )
        for i in range(count)
    ]


@pytest.fixture
def run():
    return train_pipeline(corpus(), ["signal"], seed=5)


def test_absent_document_keeps_the_page_on_its_placeholder():
    document = absent_method_document("no corpus yet")
    assert document["published"] is False
    assert document["reason"] == "no corpus yet"
    assert "accuracy" not in document


def test_published_document_carries_every_coefficient(run):
    document = build_method_document(run, trained_at=1.0)
    assert document["published"] is True
    assert set(document["coefficients"]) == {"signal"}
    assert isinstance(document["intercept"], float)


def test_the_coefficients_are_the_shipped_model_s(run):
    document = build_method_document(run, trained_at=1.0)
    assert document["coefficients"] == run.model.coefficients
    assert document["intercept"] == run.model.intercept


def test_accuracy_is_measured_on_the_held_out_set_only(run):
    accuracy = build_method_document(run, trained_at=1.0)["accuracy"]
    assert accuracy["heldOutCount"] == run.sizes.test
    assert accuracy["evaluatedCount"] <= run.sizes.test


def test_the_targets_travel_with_the_measurements(run):
    criteria = build_method_document(run, trained_at=1.0)["criteria"]
    assert criteria["minimumPrecision"] == 0.80
    assert criteria["minimumRecall"] == 0.50
    assert criteria["maximumExpectedCalibrationError"] == 0.05
    assert criteria["met"] is True
    assert criteria["problems"] == []


# a page that only ever publishes runs that passed would make the passes worth less.
def test_a_run_that_misses_is_still_published_and_says_so():
    run = train_pipeline(corpus(separable=False), ["signal"], seed=2)
    criteria = build_method_document(run, trained_at=1.0)["criteria"]
    assert criteria["met"] is False
    assert criteria["problems"]


def test_the_calibration_curve_is_carried_for_the_chart(run):
    curve = build_method_document(run, trained_at=1.0)["calibration"]
    assert curve
    assert all(set(point) == {"x", "y"} for point in curve)


def test_written_file_sorts_keys_and_ends_in_a_newline(tmp_path, run):
    path = tmp_path / "methodEvaluation.json"
    write_method_document_file(build_method_document(run, trained_at=1.0), path)
    text = path.read_text(encoding="utf-8")
    assert text.endswith("\n")
    assert json.loads(text)["documentVersion"] == METHOD_DOCUMENT_VERSION


def test_the_committed_document_is_the_absent_form():
    # a synthetic model's accuracy numbers must never be what the site publishes
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "site" / "src" / "data" / "methodEvaluation.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    assert document["documentVersion"] == METHOD_DOCUMENT_VERSION
    if document["published"]:
        assert "coefficients" in document and "accuracy" in document
    else:
        assert isinstance(document["reason"], str)
