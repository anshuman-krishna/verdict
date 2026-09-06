import type { FeatureVector } from "./featureVector";

// SPEC.md section 6: logistic regression on the feature vector, calibrated
// by isotonic regression on a held out slice. this file applies a model,
// it does not fit one. fitting needs ground truth (PLAN.md week 4) and
// lives in the research pipeline; nothing here invents coefficients, a
// calibration curve, or which features matter, since choosing those is
// the calibration target SPEC.md section 16 reserves for anshuman.

// every numeric leaf of a feature vector, under a stable dot path name.
// a model.json declares coefficients against a subset of these keys, so
// which features it actually uses is the model's choice, not this file's.
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
  };
}

export interface CalibrationPoint {
  x: number;
  y: number;
}

export interface CombinerModel {
  intercept: number;
  coefficients: Record<string, number>;
  // isotonic regression, exported as sorted control points. applied here
  // by clamped linear interpolation, the same technique bootstrap.ts uses
  // for the confidence interval.
  calibration: CalibrationPoint[];
}

export type CombinerResult =
  | { status: "insufficient-data" }
  | { status: "missing-features"; missing: string[] }
  | { status: "ok"; rawProbability: number; probability: number };

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// clamped linear interpolation over sorted control points. the fitted
// curve is the model's, this only evaluates it at a point that may fall
// between two of its knots.
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

// never guesses a value for a feature the model needs but this review set
// did not produce (SPEC.md section 5.2/5.3 both null out under thin data).
// a missing required feature is reported, not imputed, per SPEC.md section
// 6's own rule: never confident on thin data.
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
