import json

import pytest

from verdict_research.model.artifact import (
    ARTIFACT_VERSION,
    LOCAL_SLOT,
    REVIEWER_GRAPH_SLOT,
    ArtifactError,
    absent_model_artifact,
    build_model_artifact,
    parse_model_artifact,
    place_in_slot,
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
    assert parsed is not None
    assert parsed.local == MODEL
    assert parsed.reviewer_graph is None


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


GRAPH_MODEL = CombinerModel(
    intercept=0.5,
    coefficients={"reviewerGraph.flaggedReviewShare": 1.75},
    calibration=[],
)


def local_artifact():
    return build_model_artifact(MODEL, trained_at=1.0, acceptance={})


def test_the_reviewer_graph_slot_hangs_off_a_local_model():
    artifact = place_in_slot(
        local_artifact(), REVIEWER_GRAPH_SLOT, GRAPH_MODEL, trained_at=2.0, acceptance={}
    )
    parsed = parse_model_artifact(artifact)
    assert parsed is not None
    assert parsed.local == MODEL
    assert parsed.reviewer_graph == GRAPH_MODEL


def test_a_graph_model_alone_is_refused():
    with pytest.raises(ArtifactError, match="train that first"):
        place_in_slot(
            absent_model_artifact("none yet"),
            REVIEWER_GRAPH_SLOT,
            GRAPH_MODEL,
            trained_at=2.0,
            acceptance={},
        )


def test_retraining_the_local_model_keeps_the_graph_model():
    with_graph = place_in_slot(
        local_artifact(), REVIEWER_GRAPH_SLOT, GRAPH_MODEL, trained_at=2.0, acceptance={}
    )
    retrained = place_in_slot(
        with_graph, LOCAL_SLOT, MODEL, trained_at=3.0, acceptance={"precision": 0.9}
    )
    parsed = parse_model_artifact(retrained)
    assert parsed is not None
    assert parsed.reviewer_graph == GRAPH_MODEL
    assert retrained["trainedAt"] == 3.0


def test_an_unknown_slot_is_refused():
    with pytest.raises(ArtifactError, match="unknown model slot"):
        place_in_slot(local_artifact(), "elsewhere", MODEL, trained_at=1.0, acceptance={})


def test_the_local_model_stays_at_the_top_level():
    artifact = place_in_slot(
        local_artifact(), REVIEWER_GRAPH_SLOT, GRAPH_MODEL, trained_at=2.0, acceptance={}
    )
    assert artifact["intercept"] == MODEL.intercept
    assert artifact["artifactVersion"] == ARTIFACT_VERSION
