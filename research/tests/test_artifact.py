import json

import pytest

from verdict_research.model.artifact import (
    ARTIFACT_VERSION,
    ArtifactError,
    absent_model_artifact,
    build_model_artifact,
    parse_model_artifact,
    write_model_artifact_file,
)
from verdict_research.model.combine import CalibrationPoint, CombinerModel

MODEL = CombinerModel(
    intercept=-1.5,
    coefficients={"b": 2.0, "a": 1.0},
    calibration=[CalibrationPoint(x=0.0, y=0.0), CalibrationPoint(x=1.0, y=1.0)],
)


def test_absent_artifact_states_absence_rather_than_implying_it():
    artifact = absent_model_artifact("no corpus yet")
    assert artifact["present"] is False
    assert artifact["reason"] == "no corpus yet"
    assert parse_model_artifact(artifact) is None


def test_present_artifact_round_trips():
    artifact = build_model_artifact(MODEL, trained_at=1.0, acceptance={"meetsCriteria": True})
    parsed = parse_model_artifact(artifact)
    assert parsed == MODEL


def test_coefficients_are_sorted_so_a_rerun_makes_no_diff():
    artifact = build_model_artifact(MODEL, trained_at=1.0, acceptance={})
    assert list(artifact["coefficients"]) == ["a", "b"]


def test_acceptance_numbers_travel_with_the_coefficients():
    artifact = build_model_artifact(
        MODEL, trained_at=1.0, acceptance={"precision": 0.83, "recall": 0.55}
    )
    assert artifact["acceptance"] == {"precision": 0.83, "recall": 0.55}


def test_unknown_artifact_version_is_refused_not_guessed():
    with pytest.raises(ArtifactError):
        parse_model_artifact({"artifactVersion": ARTIFACT_VERSION + 1, "present": True})


def test_present_but_incomplete_is_an_error_not_a_none():
    with pytest.raises(ArtifactError):
        parse_model_artifact({"artifactVersion": ARTIFACT_VERSION, "present": True})


def test_written_file_ends_in_a_newline_and_sorts_keys(tmp_path):
    path = tmp_path / "model.json"
    write_model_artifact_file(str(path), absent_model_artifact("none"))
    text = path.read_text(encoding="utf-8")
    assert text.endswith("\n")
    assert json.loads(text)["present"] is False
    assert text.index('"artifactVersion"') < text.index('"present"')
