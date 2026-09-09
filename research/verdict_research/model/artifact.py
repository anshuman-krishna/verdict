import json
from typing import Any

from verdict_research.model.combine import CalibrationPoint, CombinerModel, ModelSet

ARTIFACT_VERSION = 1


class ArtifactError(ValueError):
    pass


# the local model stays top level
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


def write_model_artifact_file(path: str, artifact: dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(artifact, handle, indent=2, sort_keys=True)
        handle.write("\n")
