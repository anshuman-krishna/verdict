import json
from typing import Any

from verdict_research.model.combine import CalibrationPoint, CombinerModel

# SPEC.md section 4: "output artefact is model.json, a small parameter file bundled into the
# extension at build time." This module is that file's format, on both ends: the pipeline writes it
# here and the extension reads the same keys in src/score/model.ts.
#
# the absent form matters as much as the present one. extension/src/score has to import something at
# build time whether or not a model exists yet, and an empty object or a zeroed model would both
# read downstream as a real model predicting no risk. So absence is stated, not implied.

ARTIFACT_VERSION = 1


def absent_model_artifact(reason: str) -> dict[str, Any]:
    return {"artifactVersion": ARTIFACT_VERSION, "present": False, "reason": reason}


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
        "intercept": model.intercept,
        "coefficients": dict(sorted(model.coefficients.items())),
        "calibration": [{"x": point.x, "y": point.y} for point in model.calibration],
        "acceptance": acceptance,
    }


class ArtifactError(ValueError):
    pass


def parse_model_artifact(data: dict[str, Any]) -> CombinerModel | None:
    version = data.get("artifactVersion")
    if version != ARTIFACT_VERSION:
        raise ArtifactError(f"unsupported artifactVersion {version!r}")
    if data.get("present") is not True:
        return None
    try:
        return CombinerModel(
            intercept=float(data["intercept"]),
            coefficients={str(k): float(v) for k, v in data["coefficients"].items()},
            calibration=[
                CalibrationPoint(x=float(p["x"]), y=float(p["y"])) for p in data["calibration"]
            ],
        )
    except (KeyError, TypeError, ValueError) as error:
        raise ArtifactError(f"model artifact says present but is incomplete: {error}") from error


# sorted keys and a trailing newline so re-exporting an unchanged model produces no diff, the same
# reason the canary status document is written this way.
def write_model_artifact_file(path: str, artifact: dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(artifact, handle, indent=2, sort_keys=True)
        handle.write("\n")
