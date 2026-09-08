import json
from typing import Any

from verdict_research.model.combine import CalibrationPoint, CombinerModel, ModelSet

# SPEC.md section 4: "output artefact is model.json, a small parameter file bundled into the
# extension at build time." This module is that file's format, on both ends: the pipeline writes it
# here and the extension reads the same keys in src/score/model.ts.
#
# the absent form matters as much as the present one. extension/src/score has to import something at
# build time whether or not a model exists yet, and an empty object or a zeroed model would both
# read downstream as a real model predicting no risk. So absence is stated, not implied.

ARTIFACT_VERSION = 1


class ArtifactError(ValueError):
    pass


# combine.py's two models, written as one file. the local model is the top level keys, unchanged, so
# an extension that predates SPEC.md 5.6 reads it exactly as before and ignores the extra block.
REVIEWER_GRAPH_SLOT = "reviewerGraph"
LOCAL_SLOT = "local"
SLOTS = (LOCAL_SLOT, REVIEWER_GRAPH_SLOT)


def absent_model_artifact(reason: str) -> dict[str, Any]:
    return {"artifactVersion": ARTIFACT_VERSION, "present": False, "reason": reason}


def _model_body(model: CombinerModel) -> dict[str, Any]:
    return {
        "intercept": model.intercept,
        "coefficients": dict(sorted(model.coefficients.items())),
        "calibration": [{"x": point.x, "y": point.y} for point in model.calibration],
    }


# `acceptance` records what was measured on the held out set at the moment
# of export, so nothing downstream has to take a claim about accuracy on
# trust: the numbers travel with the coefficients they describe.
def build_model_artifact(
    model: CombinerModel,
    *,
    trained_at: float,
    acceptance: dict[str, Any],
) -> dict[str, Any]:
    return {
        "artifactVersion": ARTIFACT_VERSION,
        "present": True,
        "trainedAt": trained_at,
        **_model_body(model),
        "acceptance": acceptance,
    }


# a run trains one model, and the two slots are trained on different corpora: the graph model needs
# rows carrying a flagged share, which only a contributing deployment produces. so a run writes its
# own slot and leaves the other exactly as it found it, rather than a dual pipeline that would need
# both corpora present at once to write either half.
def place_in_slot(
    existing: dict[str, Any],
    slot: str,
    model: CombinerModel,
    *,
    trained_at: float,
    acceptance: dict[str, Any],
) -> dict[str, Any]:
    if slot not in SLOTS:
        raise ArtifactError(f"unknown model slot {slot!r}")
    if slot == LOCAL_SLOT:
        artifact = build_model_artifact(model, trained_at=trained_at, acceptance=acceptance)
        if REVIEWER_GRAPH_SLOT in existing:
            artifact[REVIEWER_GRAPH_SLOT] = existing[REVIEWER_GRAPH_SLOT]
        return artifact
    # the local model is what every default analysis scores with, so there is nothing to attach a
    # graph model to until one exists
    if existing.get("present") is not True:
        raise ArtifactError("no local model to attach a reviewer graph model to, train that first")
    artifact = dict(existing)
    artifact[REVIEWER_GRAPH_SLOT] = {
        **_model_body(model),
        "trainedAt": trained_at,
        "acceptance": acceptance,
    }
    return artifact


def _parse_model(data: dict[str, Any]) -> CombinerModel:
    return CombinerModel(
        intercept=float(data["intercept"]),
        coefficients={str(k): float(v) for k, v in data["coefficients"].items()},
        calibration=[
            CalibrationPoint(x=float(p["x"]), y=float(p["y"])) for p in data["calibration"]
        ],
    )


def parse_model_artifact(data: dict[str, Any]) -> ModelSet | None:
    version = data.get("artifactVersion")
    if version != ARTIFACT_VERSION:
        raise ArtifactError(f"unsupported artifactVersion {version!r}")
    if data.get("present") is not True:
        return None
    try:
        local = _parse_model(data)
        graph = data.get(REVIEWER_GRAPH_SLOT)
        return ModelSet(local=local, reviewer_graph=None if graph is None else _parse_model(graph))
    except (KeyError, TypeError, ValueError) as error:
        raise ArtifactError(f"model artifact says present but is incomplete: {error}") from error


# sorted keys and a trailing newline so re-exporting an unchanged model produces no diff, the same
# reason the canary status document is written this way.
def write_model_artifact_file(path: str, artifact: dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(artifact, handle, indent=2, sort_keys=True)
        handle.write("\n")
