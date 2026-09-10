import { describe, expect, it } from "vitest";
import type { Review } from "../extract/types";
import { localModelSet, type CombinerModel } from "./combine";
import { buildReport } from "./buildReport";

const PRIORS = { organicPrior: [0.2, 0.2, 0.2, 0.2, 0.2], injectionKernel: [0, 0, 0, 0.5, 0.5] };

function skewedReviews(): Review[] {
  return Array.from({ length: 30 }, (_, i) => ({
    rating: i < 25 ? 5 : 1,
    text: `review body number ${i}, with some distinguishing words so no two are near duplicates`,
    date: `2024-01-${String((i % 25) + 1).padStart(2, "0")}`,
    verified: i % 2 === 0,
    reviewerId: `reviewer-${i}`,
  }));
}

const WORKING_MODEL: CombinerModel = {
  intercept: -1,
  coefficients: { "ratingDeconvolution.injectedShare": 3 },
  calibration: [],
};

describe("buildReport", () => {
  it("reports not-enough-data below the minimum review count", () => {
    const outcome = buildReport({
      reviews: skewedReviews().slice(0, 5),
      seed: "product-1",
      claimedRating: 4.6,
      model: localModelSet(WORKING_MODEL),
      priors: PRIORS,
    });
    expect(outcome).toEqual({ status: "not-enough-data" });
  });

  it("reports no-model when no model is bundled, regardless of data quality", () => {
    const outcome = buildReport({
      reviews: skewedReviews(),
      seed: "product-1",
      claimedRating: 4.6,
      model: null,
      priors: PRIORS,
    });
    expect(outcome).toEqual({ status: "no-model" });
  });

  it("reports missing-features when the model needs a feature this review set has none of", () => {
    const modelNeedingLift: CombinerModel = {
      intercept: 0,
      coefficients: { "verificationConcentration.lift": 1 },
      calibration: [],
    };
    const outcome = buildReport({
      reviews: skewedReviews(),
      seed: "product-1",
      claimedRating: 4.6,
      model: localModelSet(modelNeedingLift),
      priors: PRIORS,
    });
    expect(outcome).toEqual({
      status: "missing-features",
      missing: ["verificationConcentration.lift"],
    });
  });

  it("hand computed: assembles a full report from a skewed review set", () => {
    const outcome = buildReport({
      reviews: skewedReviews(),
      seed: "product-1",
      claimedRating: 4.6,
      model: localModelSet(WORKING_MODEL),
      priors: PRIORS,
      now: () => 1_700_000_000_000,
      random: () => 0,
      bootstrapResamples: 5,
    });

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") {
      throw new Error("expected ok");
    }
    const { report } = outcome;

    expect(report.estimatedInorganicShare).toBeCloseTo(13 / 18, 5);

    expect(report.band).toBe("doubtful");

    expect(report.excludedReviewCount).toBe(22);
    expect(report.adjustedRating).toBeCloseTo(2.5, 5);
    expect(report.claimedRating).toBe(4.6);
    expect(report.totalReviewCount).toBe(30);
    expect(report.generatedAt).toBe(1_700_000_000_000);
    expect(report.serial).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(report.evidence).toHaveLength(5);

    expect(report.confidence.low).toBeCloseTo(report.confidence.high, 10);
  });

  it("produces a coherent, ordered confidence interval under real resampling", () => {
    const outcome = buildReport({
      reviews: skewedReviews(),
      seed: "product-1",
      claimedRating: 4.6,
      model: localModelSet(WORKING_MODEL),
      priors: PRIORS,
      bootstrapResamples: 20,
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") {
      throw new Error("expected ok");
    }
    expect(outcome.report.confidence.low).toBeLessThanOrEqual(outcome.report.confidence.high);
  });
});

describe("a report built with a signal unavailable", () => {
  const DEGRADING_MODEL: CombinerModel = {
    intercept: -1,
    coefficients: {
      "ratingDeconvolution.injectedShare": 3,
      "listingDrift.offTopicShare": 2,
    },
    calibration: [],
    featureQuantiles: { "listingDrift.offTopicShare": [0, 0.1, 0.2, 0.4, 0.8] },
  };

  function build(model: CombinerModel) {
    return buildReport({
      reviews: skewedReviews(),
      seed: "product-1",
      claimedRating: 4.6,
      model: localModelSet(model),
      priors: PRIORS,
      random: seededRandom(7),
      bootstrapResamples: 200,
    });
  }

  it("scores anyway and names the signal it could not read", () => {
    const outcome = build(DEGRADING_MODEL);
    expect(outcome.status).toBe("ok");
    expect(outcome.status === "ok" && outcome.report.unavailableSignals).toEqual([
      "different product",
    ]);
  });

  it("names nothing when every signal was read", () => {
    const outcome = build(WORKING_MODEL);
    expect(outcome.status === "ok" && outcome.report.unavailableSignals).toEqual([]);
  });

  it("widens the interval, because the imputed value is drawn per resample", () => {
    const degraded = build(DEGRADING_MODEL);
    const complete = build(WORKING_MODEL);
    if (degraded.status !== "ok" || complete.status !== "ok") {
      throw new Error("both reports should have been built");
    }
    const width = (outcome: typeof degraded) =>
      outcome.report.confidence.high - outcome.report.confidence.low;
    expect(width(degraded)).toBeGreaterThan(width(complete));
  });

  it("still refuses when the model carries no sketch to impute from", () => {
    const { featureQuantiles: _none, ...withoutSketch } = DEGRADING_MODEL;
    expect(build(withoutSketch).status).toBe("missing-features");
  });
});

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
