import math
from dataclasses import dataclass, field

from verdict_research.features.feature_vector import FeatureVector

# SPEC.md section 6: logistic regression on the feature vector, calibrated
# by isotonic regression on a held out slice. this module applies a model,
# it does not fit one. fitting needs ground truth (PLAN.md week 4) and its
# output artefact, model.json, is what training/calibration/export produce
# elsewhere in this package once that corpus exists. nothing here invents
# coefficients, a calibration curve, or which features matter, since
# choosing those is the calibration target SPEC.md section 6 leaves to anshuman.

FlatFeatures = dict[str, float | None]


def flatten_feature_vector(feature_vector: FeatureVector) -> FlatFeatures:
    rating = feature_vector.rating_deconvolution
    burst = feature_vector.temporal_burst
    verification = feature_vector.verification_concentration
    duplication = feature_vector.text_near_duplication
    return {
        "ratingDeconvolution.injectedShare": rating.injected_share if rating else None,
        "ratingDeconvolution.residualError": rating.residual_error if rating else None,
        "temporalBurst.burstFraction": burst.burst_fraction if burst else None,
        "temporalBurst.burstCount": burst.burst_count if burst else None,
        "temporalBurst.largestBurstShare": burst.largest_burst_share if burst else None,
        "verificationConcentration.lift": verification.lift if verification else None,
        "textNearDuplication.duplicateReviewShare": duplication.duplicate_review_share,
        "textNearDuplication.clusterCount": duplication.cluster_count,
        "textNearDuplication.largestClusterShare": duplication.largest_cluster_share,
    }


@dataclass
class CalibrationPoint:
    x: float
    y: float


@dataclass
class CombinerModel:
    intercept: float
    coefficients: dict[str, float]
    calibration: list[CalibrationPoint] = field(default_factory=list)


@dataclass
class InsufficientData:
    status: str = "insufficient-data"


@dataclass
class MissingFeatures:
    missing: list[str]
    status: str = "missing-features"


@dataclass
class CombinerOk:
    raw_probability: float
    probability: float
    status: str = "ok"


CombinerResult = InsufficientData | MissingFeatures | CombinerOk


def _sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


# clamped linear interpolation over sorted control points, mirroring
# extension/src/score/combine.ts's applyCalibration exactly.
def apply_calibration(points: list[CalibrationPoint], x: float) -> float:
    if not points:
        return x
    first = points[0]
    if x <= first.x:
        return first.y
    last = points[-1]
    if x >= last.x:
        return last.y
    for i in range(1, len(points)):
        upper = points[i]
        if x <= upper.x:
            lower = points[i - 1]
            fraction = (x - lower.x) / (upper.x - lower.x)
            return lower.y + fraction * (upper.y - lower.y)
    return last.y


# never guesses a value for a feature the model needs but this review set
# did not produce. a missing required feature is reported, not imputed,
# per SPEC.md section 6's own rule: never confident on thin data.
def apply_model(feature_vector: FeatureVector, model: CombinerModel) -> CombinerResult:
    if not feature_vector.meets_minimum_data:
        return InsufficientData()

    flat = flatten_feature_vector(feature_vector)
    required_keys = list(model.coefficients.keys())
    missing = [key for key in required_keys if flat.get(key) is None]
    if missing:
        return MissingFeatures(missing=missing)

    linear = model.intercept
    for key in required_keys:
        linear += model.coefficients[key] * flat[key]

    raw_probability = _sigmoid(linear)
    probability = apply_calibration(model.calibration, raw_probability)
    return CombinerOk(raw_probability=raw_probability, probability=probability)
