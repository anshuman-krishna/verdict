import { describe, expect, it } from "vitest";
import {
  applyCalibration,
  applyModel,
  flattenFeatureVector,
  localModelSet,
  selectModel,
  type CombinerModel,
} from "./combine";
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
    listingDrift: {
      offTopicShare: null,
      offTopicCount: 0,
      meanDistance: null,
      changePoint: null,
      driftStatistic: 0,
      embeddedCount: 0,
    },
    reviewerGraph: null,
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
      "listingDrift.offTopicShare": null,
      "listingDrift.meanDistance": null,
      "listingDrift.driftStatistic": 0,
      "reviewerGraph.flaggedReviewShare": null,
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

const GRAPH_RESULT = {
  flaggedReviewShare: 0.4,
  flaggedReviewCount: 4,
  flaggedReviewerCount: 3,
  knownReviewerCount: 8,
  identifiedReviewCount: 10,
};

const LOCAL: CombinerModel = { intercept: -1, coefficients: {}, calibration: [] };
const GRAPH: CombinerModel = {
  intercept: 1,
  coefficients: { "reviewerGraph.flaggedReviewShare": 2 },
  calibration: [],
};

describe("selectModel", () => {
  it("uses the local model when no lookup ran", () => {
    expect(selectModel({ local: LOCAL, reviewerGraph: GRAPH }, featureVector())).toBe(LOCAL);
  });

  it("uses the graph model once the vector carries a flagged share", () => {
    const vector = featureVector({ reviewerGraph: GRAPH_RESULT });
    expect(selectModel({ local: LOCAL, reviewerGraph: GRAPH }, vector)).toBe(GRAPH);
  });

  // SPEC.md section 13: the service being unreachable degrades to local signals, silently
  it("falls back to local when the artefact carries no graph model", () => {
    const vector = featureVector({ reviewerGraph: GRAPH_RESULT });
    expect(selectModel(localModelSet(LOCAL), vector)).toBe(LOCAL);
  });

  // a listing where nobody is identifiable has no share to score against, flagged or not
  it("falls back to local when the lookup ran but found no identifiable reviewer", () => {
    const vector = featureVector({
      reviewerGraph: { ...GRAPH_RESULT, flaggedReviewShare: null, identifiedReviewCount: 0 },
    });
    expect(selectModel({ local: LOCAL, reviewerGraph: GRAPH }, vector)).toBe(LOCAL);
  });

  it("uses the graph model when the lookup ran and flagged nobody", () => {
    const vector = featureVector({
      reviewerGraph: { ...GRAPH_RESULT, flaggedReviewShare: 0, flaggedReviewCount: 0 },
    });
    expect(selectModel({ local: LOCAL, reviewerGraph: GRAPH }, vector)).toBe(GRAPH);
  });
});

describe("the reviewer graph feature", () => {
  it("is null when no lookup supplied it", () => {
    expect(flattenFeatureVector(featureVector())["reviewerGraph.flaggedReviewShare"]).toBeNull();
  });

  it("carries the share through once it exists", () => {
    const flat = flattenFeatureVector(featureVector({ reviewerGraph: GRAPH_RESULT }));
    expect(flat["reviewerGraph.flaggedReviewShare"]).toBe(0.4);
  });

  // a model naming the feature on a default analysis is a gap, never a zero
  it("reports missing-features rather than scoring a lookup that never ran", () => {
    expect(applyModel(featureVector(), GRAPH)).toEqual({
      status: "missing-features",
      missing: ["reviewerGraph.flaggedReviewShare"],
    });
  });
});
