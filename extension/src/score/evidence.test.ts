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
    ...overrides,
  };
}

describe("buildEvidence", () => {
  it("always returns exactly five rows, ending with the unbuilt 5.4 placeholder", () => {
    const rows = buildEvidence(baseVector());
    expect(rows).toHaveLength(5);
    expect(rows[4]).toEqual({
      signal: "different product",
      strength: "none",
      value: null,
      detail: "This check is not available in this release.",
    });
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
