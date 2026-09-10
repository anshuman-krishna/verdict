import { describe, expect, it } from "vitest";
import { localModelSet, type CombinerModel, type ModelSet } from "./combine";
import type { FeatureVector } from "./featureVector";
import { rescore, rescoreAll } from "./rescore";

function vector(overrides: Partial<FeatureVector> = {}): FeatureVector {
  return {
    meetsMinimumData: true,
    ratingDeconvolution: { injectedShare: 0.5, residualError: 0.01 },
    temporalBurst: { bursts: [], burstFraction: 0.1, burstCount: 1, largestBurstShare: 0.1 },
    verificationConcentration: { lift: 1.5, baseCount: 10 },
    textNearDuplication: { duplicateReviewShare: 0.25, clusterCount: 2, largestClusterShare: 0.25 },
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

const MODEL: CombinerModel = {
  intercept: -2,
  coefficients: { "ratingDeconvolution.injectedShare": 3 },
  calibration: [],
};

describe("rescore", () => {
  it("scores a stored vector with the model given rather than the one that wrote it", () => {
    const result = rescore({ featureVector: vector() }, localModelSet(MODEL));

    expect(result?.probability).toBeCloseTo(0.3775, 4);
    expect(result?.band).toBe("mostly-clean");
  });

  it("returns null for an entry written before the vector was stored", () => {
    expect(rescore({}, localModelSet(MODEL))).toBeNull();
  });

  it("returns null when no model is bundled", () => {
    expect(rescore({ featureVector: vector() }, null)).toBeNull();
  });

  it("returns null rather than a score the model has no feature for", () => {
    const missing = localModelSet({
      intercept: 0,
      coefficients: { "listingDrift.offTopicShare": 1 },
      calibration: [],
    });

    expect(rescore({ featureVector: vector() }, missing)).toBeNull();
  });

  it("returns null under the minimum data thresholds", () => {
    const thin = vector({ meetsMinimumData: false });

    expect(rescore({ featureVector: thin }, localModelSet(MODEL))).toBeNull();
  });

  it("prefers the reviewer graph model when the stored vector carries that signal", () => {
    const models: ModelSet = {
      local: MODEL,
      reviewerGraph: {
        intercept: 4,
        coefficients: { "reviewerGraph.flaggedReviewShare": 1 },
        calibration: [],
      },
    };
    const withGraph = vector({
      reviewerGraph: {
        flaggedReviewShare: 0.5,
        flaggedReviewCount: 2,
        flaggedReviewerCount: 1,
        knownReviewerCount: 2,
        identifiedReviewCount: 4,
      },
    });

    expect(rescore({ featureVector: withGraph }, models)?.probability).toBeCloseTo(0.98901, 4);
  });
});

describe("rescoreAll", () => {
  it("keeps every entry, scored or not, in the order given", () => {
    const entries = [{ id: 1, featureVector: vector() }, { id: 2 }];

    const results = rescoreAll(entries, localModelSet(MODEL));

    expect(results.map((entry) => entry.id)).toEqual([1, 2]);
    expect(results[0]?.rescored).not.toBeNull();
    expect(results[1]?.rescored).toBeNull();
  });
});

describe("rescoring a stored vector missing a signal", () => {
  const IMPUTING: CombinerModel = {
    intercept: -2,
    coefficients: {
      "ratingDeconvolution.injectedShare": 3,
      "listingDrift.offTopicShare": 2,
    },
    calibration: [],
    featureQuantiles: { "listingDrift.offTopicShare": [0, 0.2, 0.4] },
  };

  it("scores at the median rather than dropping the entry", () => {
    const result = rescore({ featureVector: vector() }, localModelSet(IMPUTING));
    expect(result?.unavailableSignals).toEqual(["different product"]);
    expect(result?.probability).toBeCloseTo(1 / (1 + Math.exp(-(-2 + 3 * 0.5 + 2 * 0.2))), 12);
  });

  it("names nothing when the stored vector carried every signal", () => {
    const result = rescore({ featureVector: vector() }, localModelSet(MODEL));
    expect(result?.unavailableSignals).toEqual([]);
  });

  it("still returns null when the model carries no sketch to impute from", () => {
    const { featureQuantiles: _none, ...withoutSketch } = IMPUTING;
    expect(rescore({ featureVector: vector() }, localModelSet(withoutSketch))).toBeNull();
  });
});
