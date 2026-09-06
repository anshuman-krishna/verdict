import { describe, expect, it } from "vitest";
import type { Report } from "../score/report";
import { rosetteInputFromReport } from "./rosetteInputFromReport";

function sampleReport(overrides: Partial<Report> = {}): Report {
  return {
    serial: "AAAA-BBBB",
    band: "mixed",
    claimedRating: 4.6,
    adjustedRating: 3.9,
    totalReviewCount: 100,
    excludedReviewCount: 10,
    estimatedInorganicShare: 0.1,
    confidence: { low: 0.05, high: 0.15 },
    evidence: [
      { signal: "rating shape", strength: "moderate", value: 0.1, detail: "" },
      { signal: "arrival timing", strength: "strong", value: 0.4, detail: "" },
      { signal: "verification pattern", strength: "none", value: null, detail: "" },
      { signal: "duplicate text", strength: "weak", value: 0.02, detail: "" },
      { signal: "different product", strength: "none", value: null, detail: "" },
    ],
    generatedAt: 0,
    ...overrides,
  };
}

describe("rosetteInputFromReport", () => {
  it("pulls burst and duplicate shares off the matching evidence rows by name", () => {
    expect(rosetteInputFromReport(sampleReport())).toEqual({
      burstShare: 0.4,
      duplicateShare: 0.02,
      estimatedInorganicShare: 0.1,
      band: "mixed",
    });
  });

  it("defaults to 0 when a row's value is null", () => {
    const report = sampleReport({
      evidence: [
        { signal: "arrival timing", strength: "none", value: null, detail: "" },
        { signal: "duplicate text", strength: "none", value: null, detail: "" },
      ],
    });
    expect(rosetteInputFromReport(report)).toMatchObject({ burstShare: 0, duplicateShare: 0 });
  });
});
