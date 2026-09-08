import { describe, expect, it } from "vitest";
import type { FeatureVector } from "./featureVector";
import { buildEvidence } from "./evidence";

function baseVector(overrides: Partial<FeatureVector> = {}): FeatureVector {
  return {
    meetsMinimumData: true,
    ratingDeconvolution: null,
    temporalBurst: null,
    verificationConcentration: null,
    textNearDuplication: { duplicateReviewShare: null, clusterCount: 0, largestClusterShare: 0 },
    listingDrift: {
      offTopicShare: null,
      offTopicCount: 0,
      meanDistance: null,
      changePoint: null,
      driftStatistic: 0,
      embeddedCount: 0,
    },
    ...overrides,
  };
}

describe("buildEvidence", () => {
  it("always returns exactly five rows, one per signal", () => {
    const rows = buildEvidence(baseVector());
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.signal)).toEqual([
      "rating shape",
      "arrival timing",
      "verification pattern",
      "duplicate text",
      "different product",
    ]);
  });

  it("says the drift check found no text rather than reporting a zero", () => {
    const rows = buildEvidence(baseVector());
    expect(rows[4]).toEqual({
      signal: "different product",
      strength: "none",
      value: null,
      detail: "No review text to compare against the product.",
    });
  });

  it("counts off topic reviews and dates the shift", () => {
    const rows = buildEvidence(baseVector({
      listingDrift: {
        offTopicShare: 0.5,
        offTopicCount: 12,
        meanDistance: 0.8,
        changePoint: { day: 20000, afterCount: 12 },
        driftStatistic: 1.1,
        embeddedCount: 24,
      },
    }));
    expect(rows[4]?.strength).toBe("strong");
    expect(rows[4]?.detail).toBe(
      "12 of 24 reviews with text share no wording with the current product title and category."
        + " The wording of reviews shifts around 2024-10-04.",
    );
  });

  it("omits the date when nothing crossed the reporting threshold", () => {
    const rows = buildEvidence(baseVector({
      listingDrift: {
        offTopicShare: 0,
        offTopicCount: 0,
        meanDistance: 0.4,
        changePoint: null,
        driftStatistic: 0.01,
        embeddedCount: 24,
      },
    }));
    expect(rows[4]?.strength).toBe("weak");
    expect(rows[4]?.detail).not.toContain("shifts around");
  });

  it("says there is no product to compare against, and keeps the shift it can still see", () => {
    const rows = buildEvidence(baseVector({
      listingDrift: {
        offTopicShare: null,
        offTopicCount: 0,
        meanDistance: null,
        changePoint: { day: 20000, afterCount: 12 },
        driftStatistic: 1.1,
        embeddedCount: 24,
      },
    }));
    expect(rows[4]?.strength).toBe("none");
    expect(rows[4]?.detail).toBe(
      "No product title to compare the reviews against. The wording of reviews shifts around 2024-10-04.",
    );
  });

  it("reports none for every signal when the underlying result is null", () => {
    const rows = buildEvidence(baseVector());
    expect(rows.slice(0, 4).every((row) => row.strength === "none" && row.value === null)).toBe(true);
  });

  it("hand computed: a high injected share reads as strong rating shape evidence", () => {
    const rows = buildEvidence(
      baseVector({ ratingDeconvolution: { injectedShare: 0.5, residualError: 0.01 } }),
    );
    expect(rows[0]).toMatchObject({ signal: "rating shape", strength: "strong", value: 0.5 });
    expect(rows[0]?.detail).toContain("50 percent");
  });

  it("hand computed: a lift of 3 reads as strong verification evidence", () => {
    const rows = buildEvidence(baseVector({ verificationConcentration: { lift: 3, baseCount: 40 } }));
    expect(rows[2]).toMatchObject({ signal: "verification pattern", strength: "strong", value: 3 });
  });

  it("hand computed: zero bursts reads as weak, not none, arrival timing evidence", () => {
    const rows = buildEvidence(
      baseVector({ temporalBurst: { burstFraction: 0, burstCount: 0, largestBurstShare: 0, bursts: [] } }),
    );
    expect(rows[1]).toMatchObject({ signal: "arrival timing", strength: "weak", value: 0 });
  });
});
