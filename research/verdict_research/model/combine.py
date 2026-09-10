import math
from dataclasses import dataclass, field

from verdict_research.features.feature_vector import FeatureVector

FlatFeatures = dict[str, float | None]


def flatten_feature_vector(feature_vector: FeatureVector) -> FlatFeatures:
    rating = feature_vector.rating_deconvolution
    burst = feature_vector.temporal_burst
    verification = feature_vector.verification_concentration
    duplication = feature_vector.text_near_duplication
    drift = feature_vector.listing_drift
    graph = feature_vector.reviewer_graph
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
        "listingDrift.offTopicShare": drift.off_topic_share,
        "listingDrift.meanDistance": drift.mean_distance,
        "listingDrift.driftStatistic": drift.drift_statistic,
        "reviewerGraph.flaggedReviewShare": graph.flagged_review_share if graph else None,
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
    feature_quantiles: dict[str, list[float]] = field(default_factory=dict)


@dataclass
class ModelSet:
    local: CombinerModel
    reviewer_graph: CombinerModel | None = None


def select_model(models: ModelSet, feature_vector: FeatureVector) -> CombinerModel:
    graph = feature_vector.reviewer_graph
    share = None if graph is None else graph.flagged_review_share
    if models.reviewer_graph is not None and share is not None:
        return models.reviewer_graph
    return models.local


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
    imputed: list[str] = field(default_factory=list)
    status: str = "ok"


CombinerResult = InsufficientData | MissingFeatures | CombinerOk


def _sigmoid(x: float) -> float:
    if x >= 0:
        return 1 / (1 + math.exp(-x))
    e = math.exp(x)
    return e / (1 + e)


MEDIAN_FRACTION = 0.5


def quantile_value(quantiles: list[float], fraction: float) -> float:
    if not quantiles:
        raise ValueError("quantile_value needs at least one quantile")
    position = min(max(fraction, 0.0), 1.0) * (len(quantiles) - 1)
    lower = math.floor(position)
    upper = min(lower + 1, len(quantiles) - 1)
    weight = position - lower
    return quantiles[lower] * (1 - weight) + quantiles[upper] * weight


SIGNAL_NAMES = {
    "ratingDeconvolution": "rating shape",
    "temporalBurst": "arrival timing",
    "verificationConcentration": "verification pattern",
    "textNearDuplication": "duplicate text",
    "listingDrift": "different product",
    "reviewerGraph": "reviewer network",
}


def signals_for(feature_keys: list[str]) -> list[str]:
    names: list[str] = []
    for key in feature_keys:
        name = SIGNAL_NAMES.get(key.split(".")[0])
        if name is not None and name not in names:
            names.append(name)
    return names


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


def score_features(
    model: CombinerModel, flat: FlatFeatures, *, impute: float | None = None
) -> CombinerResult:
    required_keys = list(model.coefficients.keys())
    missing = [key for key in required_keys if flat.get(key) is None]
    if missing:
        if impute is None:
            return MissingFeatures(missing=missing)
        unsketched = [key for key in missing if not model.feature_quantiles.get(key)]
        if unsketched:
            return MissingFeatures(missing=unsketched)
        # all imputed is the prior
        if len(missing) == len(required_keys):
            return InsufficientData()

    fraction = MEDIAN_FRACTION if impute is None else impute
    linear = model.intercept
    for key in required_keys:
        value = flat.get(key)
        if value is None:
            value = quantile_value(model.feature_quantiles[key], fraction)
        linear += model.coefficients[key] * value

    raw_probability = _sigmoid(linear)
    probability = apply_calibration(model.calibration, raw_probability)
    return CombinerOk(raw_probability=raw_probability, probability=probability, imputed=missing)


def apply_model(
    feature_vector: FeatureVector, model: CombinerModel, *, impute: float | None = None
) -> CombinerResult:
    if not feature_vector.meets_minimum_data:
        return InsufficientData()
    return score_features(model, flatten_feature_vector(feature_vector), impute=impute)
