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
  featureQuantiles?: Record<string, number[]>;
}

export const MEDIAN_FRACTION = 0.5;

export function quantileValue(quantiles: readonly number[], fraction: number): number {
  if (quantiles.length === 0) {
    throw new Error("quantileValue needs at least one quantile");
  }
  const position = Math.min(Math.max(fraction, 0), 1) * (quantiles.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, quantiles.length - 1);
  const weight = position - lower;
  return (quantiles[lower] as number) * (1 - weight) + (quantiles[upper] as number) * weight;
}

export const SIGNAL_NAMES: Record<string, string> = {
  ratingDeconvolution: "rating shape",
  temporalBurst: "arrival timing",
  verificationConcentration: "verification pattern",
  textNearDuplication: "duplicate text",
  listingDrift: "different product",
  reviewerGraph: "reviewer network",
};

export function signalsFor(featureKeys: readonly string[]): string[] {
  const names: string[] = [];
  for (const key of featureKeys) {
    const name = SIGNAL_NAMES[key.split(".")[0] as string];
    if (name !== undefined && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
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
  | { status: "ok"; rawProbability: number; probability: number; imputed: string[] };

export interface ApplyModelOptions {
  impute?: number;
}

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

export function scoreFeatures(
  model: CombinerModel,
  flat: FlatFeatures,
  options: ApplyModelOptions = {},
): CombinerResult {
  const requiredKeys = Object.keys(model.coefficients);
  const quantiles = model.featureQuantiles ?? {};
  const missing = requiredKeys.filter((key) => flat[key] === null || flat[key] === undefined);
  if (missing.length > 0) {
    if (options.impute === undefined) {
      return { status: "missing-features", missing };
    }
    const unsketched = missing.filter((key) => (quantiles[key]?.length ?? 0) === 0);
    if (unsketched.length > 0) {
      return { status: "missing-features", missing: unsketched };
    }
    // all imputed is the prior
    if (missing.length === requiredKeys.length) {
      return { status: "insufficient-data" };
    }
  }

  const fraction = options.impute ?? MEDIAN_FRACTION;
  let linear = model.intercept;
  for (const key of requiredKeys) {
    const present = flat[key];
    const value = present === null || present === undefined
      ? quantileValue(quantiles[key] as number[], fraction)
      : present;
    linear += (model.coefficients[key] as number) * value;
  }

  const rawProbability = sigmoid(linear);
  const probability = applyCalibration(model.calibration, rawProbability);
  return { status: "ok", rawProbability, probability, imputed: missing };
}

export function applyModel(
  featureVector: FeatureVector,
  model: CombinerModel,
  options: ApplyModelOptions = {},
): CombinerResult {
  if (!featureVector.meetsMinimumData) {
    return { status: "insufficient-data" };
  }
  return scoreFeatures(model, flattenFeatureVector(featureVector), options);
}
