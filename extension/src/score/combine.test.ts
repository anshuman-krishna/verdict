import { describe, expect, it } from "vitest";
import { applyCalibration, applyModel, flattenFeatureVector } from "./combine";
import type { FeatureVector } from "./featureVector";

const BASE_TEXT_DUPLICATION = {
  duplicateReviewShare: 0.25,
  clusterCount: 2,
  largestClusterShare: 0.25,
};

function featureVector(overrides: Partial<FeatureVector> = {}): FeatureVector {
  return {
    meetsMinimumData: true,
    ratingDeconvolution: { injectedShare: 0.5, residualError: 0.01 },
    temporalBurst: { bursts: [], burstFraction: 0.1, burstCount: 1, largestBurstShare: 0.1 },
    verificationConcentration: { lift: 1.5, baseCount: 10 },
    textNearDuplication: BASE_TEXT_DUPLICATION,
    ...overrides,
  };
}

describe("flattenFeatureVector", () => {
  it("exposes every numeric leaf under a stable dot path", () => {
    const flat = flattenFeatureVector(featureVector());
    expect(flat).toEqual({
      "ratingDeconvolution.injectedShare": 0.5,
      "ratingDeconvolution.residualError": 0.01,
      "temporalBurst.burstFraction": 0.1,
      "temporalBurst.burstCount": 1,
      "temporalBurst.largestBurstShare": 0.1,
      "verificationConcentration.lift": 1.5,
      "textNearDuplication.duplicateReviewShare": 0.25,
      "textNearDuplication.clusterCount": 2,
      "textNearDuplication.largestClusterShare": 0.25,
    });
  });

  it("nulls out a signal's features when the signal itself is null", () => {
    const flat = flattenFeatureVector(
      featureVector({ ratingDeconvolution: null, temporalBurst: null, verificationConcentration: null }),
    );
    expect(flat["ratingDeconvolution.injectedShare"]).toBeNull();
    expect(flat["temporalBurst.burstFraction"]).toBeNull();
    expect(flat["verificationConcentration.lift"]).toBeNull();
  });
});

describe("applyCalibration", () => {
  const points = [
    { x: 0, y: 0.1 },
    { x: 0.5, y: 0.4 },
    { x: 1, y: 0.9 },
  ];

  it("interpolates linearly between the two nearest knots", () => {
    expect(applyCalibration(points, 0.25)).toBeCloseTo(0.25, 10);
  });

  it("returns a knot's own y when x lands exactly on it", () => {
    expect(applyCalibration(points, 0.5)).toBeCloseTo(0.4, 10);
  });

  it("clamps below the first knot", () => {
    expect(applyCalibration(points, -1)).toBe(0.1);
  });

  it("clamps above the last knot", () => {
    expect(applyCalibration(points, 2)).toBe(0.9);
  });

  it("is the identity when no calibration curve is supplied", () => {
    expect(applyCalibration([], 0.42)).toBe(0.42);
  });
});

describe("applyModel", () => {
  it("reports insufficient data without touching the model", () => {
    const result = applyModel(featureVector({ meetsMinimumData: false }), {
      intercept: 0,
      coefficients: {},
      calibration: [],
    });
    expect(result).toEqual({ status: "insufficient-data" });
  });

  it("reports which required features are missing rather than imputing them", () => {
    const result = applyModel(featureVector({ verificationConcentration: null }), {
      intercept: 0,
      coefficients: {
        "ratingDeconvolution.injectedShare": 3,
        "verificationConcentration.lift": 1,
      },
      calibration: [],
    });
    expect(result).toEqual({
      status: "missing-features",
      missing: ["verificationConcentration.lift"],
    });
  });

  it("combines a linear score through a sigmoid, then the calibration curve", () => {
    // linear = -2 + 3*0.5 + 2*0.25 = 0, sigmoid(0) = 0.5 exactly
    const result = applyModel(featureVector(), {
      intercept: -2,
      coefficients: {
        "ratingDeconvolution.injectedShare": 3,
        "textNearDuplication.duplicateReviewShare": 2,
      },
      calibration: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.rawProbability).toBeCloseTo(0.5, 10);
      expect(result.probability).toBeCloseTo(0.5, 10);
    }
  });

  it("lets calibration move the probability away from the raw sigmoid", () => {
    const result = applyModel(featureVector(), {
      intercept: -2,
      coefficients: {
        "ratingDeconvolution.injectedShare": 3,
        "textNearDuplication.duplicateReviewShare": 2,
      },
      calibration: [
        { x: 0, y: 0.1 },
        { x: 0.5, y: 0.8 },
        { x: 1, y: 0.9 },
      ],
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.rawProbability).toBeCloseTo(0.5, 10);
      expect(result.probability).toBeCloseTo(0.8, 10);
    }
  });
});
