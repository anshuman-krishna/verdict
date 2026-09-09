import type { FeatureVector } from "./featureVector";


export type FlatFeatures = Record<string, number | null>;

export function flattenFeatureVector(featureVector: FeatureVector): FlatFeatures {
  return {
    "ratingDeconvolution.injectedShare": featureVector.ratingDeconvolution?.injectedShare ?? null,
    "ratingDeconvolution.residualError": featureVector.ratingDeconvolution?.residualError ?? null,
    "temporalBurst.burstFraction": featureVector.temporalBurst?.burstFraction ?? null,
    "temporalBurst.burstCount": featureVector.temporalBurst?.burstCount ?? null,
    "temporalBurst.largestBurstShare": featureVector.temporalBurst?.largestBurstShare ?? null,
    "verificationConcentration.lift": featureVector.verificationConcentration?.lift ?? null,
    "textNearDuplication.duplicateReviewShare":
      featureVector.textNearDuplication.duplicateReviewShare,
    "textNearDuplication.clusterCount": featureVector.textNearDuplication.clusterCount,
    "textNearDuplication.largestClusterShare":
      featureVector.textNearDuplication.largestClusterShare,
    "listingDrift.offTopicShare": featureVector.listingDrift.offTopicShare,
    "listingDrift.meanDistance": featureVector.listingDrift.meanDistance,
    "listingDrift.driftStatistic": featureVector.listingDrift.driftStatistic,
    "reviewerGraph.flaggedReviewShare": featureVector.reviewerGraph?.flaggedReviewShare ?? null,
  };
}

export interface CalibrationPoint {
  x: number;
  y: number;
}

export interface CombinerModel {
  intercept: number;
  coefficients: Record<string, number>;
  calibration: CalibrationPoint[];
}

export interface ModelSet {
  local: CombinerModel;
  reviewerGraph: CombinerModel | null;
}

export function localModelSet(model: CombinerModel): ModelSet {
  return { local: model, reviewerGraph: null };
}

// the graph model calibrates separately
export function selectModel(models: ModelSet, featureVector: FeatureVector): CombinerModel {
  const share = featureVector.reviewerGraph?.flaggedReviewShare ?? null;
  if (models.reviewerGraph !== null && share !== null) {
    return models.reviewerGraph;
  }
  return models.local;
}

export type CombinerResult =
  | { status: "insufficient-data" }
  | { status: "missing-features"; missing: string[] }
  | { status: "ok"; rawProbability: number; probability: number };

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function applyCalibration(points: readonly CalibrationPoint[], x: number): number {
  if (points.length === 0) {
    return x;
  }
  const first = points[0] as CalibrationPoint;
  if (x <= first.x) {
    return first.y;
  }
  const last = points[points.length - 1] as CalibrationPoint;
  if (x >= last.x) {
    return last.y;
  }
  for (let i = 1; i < points.length; i++) {
    const upper = points[i] as CalibrationPoint;
    if (x <= upper.x) {
      const lower = points[i - 1] as CalibrationPoint;
      const fraction = (x - lower.x) / (upper.x - lower.x);
      return lower.y + fraction * (upper.y - lower.y);
    }
  }
  return last.y;
}

export function applyModel(featureVector: FeatureVector, model: CombinerModel): CombinerResult {
  if (!featureVector.meetsMinimumData) {
    return { status: "insufficient-data" };
  }

  const flat = flattenFeatureVector(featureVector);
  const requiredKeys = Object.keys(model.coefficients);
  const missing = requiredKeys.filter((key) => flat[key] === null || flat[key] === undefined);
  if (missing.length > 0) {
    return { status: "missing-features", missing };
  }

  let linear = model.intercept;
  for (const key of requiredKeys) {
    linear += (model.coefficients[key] as number) * (flat[key] as number);
  }

  const rawProbability = sigmoid(linear);
  const probability = applyCalibration(model.calibration, rawProbability);
  return { status: "ok", rawProbability, probability };
}
