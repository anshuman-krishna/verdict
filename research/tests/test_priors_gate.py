import json
from pathlib import Path

from verdict_research.features.priors import priors_category_keys, priors_document_digest
from verdict_research.model.artifact import (
    ARTIFACT_VERSION,
    REVIEWER_GRAPH_SLOT,
    absent_model_artifact,
    build_model_artifact,
    place_in_slot,
    priors_mismatch,
)
from verdict_research.model.combine import CalibrationPoint, CombinerModel

SHIPPED = Path(__file__).resolve().parents[2] / "extension" / "src" / "score" / "model.json"

MODEL = CombinerModel(
    intercept=-4,
    coefficients={"ratingDeconvolution.injectedShare": 8},
    calibration=[CalibrationPoint(0, 0), CalibrationPoint(1, 1)],
)


def artifact() -> dict:
    return build_model_artifact(MODEL, trained_at=0.0, acceptance={})


def shipped_artifact() -> dict:
    with open(SHIPPED, encoding="utf-8") as handle:
        return json.load(handle)


def test_the_shipped_artifact_is_a_version_this_build_understands():
    assert shipped_artifact()["artifactVersion"] == ARTIFACT_VERSION


# the gate: what scores in the browser and what trained the model are one document
def test_the_shipped_model_was_trained_under_the_priors_it_scores_with():
    assert priors_mismatch(shipped_artifact()) is None


def test_a_fresh_artifact_records_the_priors_of_this_checkout():
    recorded = artifact()["priors"]
    assert recorded["digest"] == priors_document_digest()
    assert recorded["categories"] == priors_category_keys()
    assert priors_mismatch(artifact()) is None


def test_an_absent_model_claims_no_priors():
    absent = absent_model_artifact("no labelled corpus exists yet")
    assert "priors" not in absent
    assert priors_mismatch(absent) is None


def test_names_the_retrain_when_the_priors_moved_under_the_model():
    stale = artifact()
    stale["priors"] = {"digest": "00000000", "categories": []}

    problem = priors_mismatch(stale)

    assert problem is not None
    assert "00000000" in problem
    assert "retrain" in problem


def test_catches_a_model_from_before_priors_were_recorded():
    older = artifact()
    del older["priors"]

    assert priors_mismatch(older) == (
        "the local model records no priors, so nothing says what trained it"
    )


def test_checks_the_graph_slot_on_its_own():
    both = place_in_slot(artifact(), REVIEWER_GRAPH_SLOT, MODEL, trained_at=1.0, acceptance={})
    assert priors_mismatch(both) is None

    both[REVIEWER_GRAPH_SLOT]["priors"] = {"digest": "00000000", "categories": []}
    problem = priors_mismatch(both)
    assert problem is not None
    assert REVIEWER_GRAPH_SLOT in problem
