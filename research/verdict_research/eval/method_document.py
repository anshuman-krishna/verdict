import json
from pathlib import Path
from typing import Any

from verdict_research.model.pipeline import (
    MAXIMUM_EXPECTED_CALIBRATION_ERROR,
    MINIMUM_PRECISION,
    MINIMUM_RECALL,
    TrainingRun,
    acceptance_problems,
)

METHOD_DOCUMENT_VERSION = 1


def absent_method_document(reason: str) -> dict[str, Any]:
    return {"documentVersion": METHOD_DOCUMENT_VERSION, "published": False, "reason": reason}


def build_method_document(run: TrainingRun, trained_at: float) -> dict[str, Any]:
    point = run.operating_point
    return {
        "documentVersion": METHOD_DOCUMENT_VERSION,
        "published": True,
        "trainedAt": trained_at,
        "intercept": run.model.intercept,
        "coefficients": dict(sorted(run.model.coefficients.items())),
        "accuracy": {
            "decisionThreshold": None if point is None else point.threshold,
            "precision": None if point is None else point.precision,
            "recall": None if point is None else point.recall,
            "expectedCalibrationError": run.report.expected_calibration_error,
            "evaluatedCount": run.report.evaluated_count,
            "imputedCount": run.report.imputed_count,
            "heldOutCount": run.sizes.test,
        },
        "criteria": {
            "minimumPrecision": MINIMUM_PRECISION,
            "minimumRecall": MINIMUM_RECALL,
            "maximumExpectedCalibrationError": MAXIMUM_EXPECTED_CALIBRATION_ERROR,
            "met": not acceptance_problems(run),
            "problems": acceptance_problems(run),
        },
        "calibration": [{"x": p.x, "y": p.y} for p in run.model.calibration],
    }


def write_method_document_file(document: dict[str, Any], path: str | Path) -> None:
    Path(path).write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
