import { describe, expect, it } from "vitest";
import type { FeatureVector } from "../score/featureVector";
import type { Report } from "../score/report";
import { parseReading, readingFromReport } from "./reading";

const CHECKED = Date.parse("2026-03-01T12:00:00Z");

const REPORT: Report = {
  serial: "7F2A-0091",
  band: "mixed",
  probability: 0.42,
  claimedRating: 4.6,
  adjustedRating: 3.9,
  totalReviewCount: 8431,
  excludedReviewCount: 1208,
  estimatedInorganicShare: 0.14,
  confidence: { low: 0.11, high: 0.24 },
  evidence: [],
  unavailableSignals: [],
  absentSignals: [],
  generatedAt: CHECKED,
};

const VECTOR = {
  meetsMinimumData: true,
  ratingDeconvolution: { injectedShare: 0.14, residualError: 0.01 },
  temporalBurst: { burstFraction: 0.3, burstCount: 2, largestBurstShare: 0.19 },
  verificationConcentration: null,
  textNearDuplication: { duplicateReviewShare: 0.07, clusterCount: 3, largestClusterShare: 0.04 },
  listingDrift: { offTopicShare: 0.02, meanDistance: 0.61, driftStatistic: 0.33 },
  reviewerGraph: null,
} as unknown as FeatureVector;

describe("readingFromReport", () => {
  it("keeps the numbers a later check is compared against, and nothing else", () => {
    const reading = readingFromReport(REPORT, VECTOR);

    expect(reading.at).toBe(CHECKED);
    expect(reading.band).toBe("mixed");
    expect(reading.adjustedRating).toBe(3.9);
    expect(reading.totalReviewCount).toBe(8431);
    expect(reading.features?.["temporalBurst.largestBurstShare"]).toBe(0.19);
    expect(Object.keys(reading)).not.toContain("evidence");
    expect(Object.keys(reading)).not.toContain("serial");
  });

  it("holds no features when the check kept none", () => {
    expect(readingFromReport(REPORT).features).toBeNull();
  });
});

describe("parseReading", () => {
  it("round trips what it writes", () => {
    const reading = readingFromReport(REPORT, VECTOR);

    expect(parseReading(JSON.parse(JSON.stringify(reading)))).toEqual(reading);
  });

  it("refuses anything with no time on it, since it could not be compared", () => {
    expect(parseReading(null)).toBeNull();
    expect(parseReading({ band: "mixed" })).toBeNull();
    expect(parseReading("a reading")).toBeNull();
  });

  it("reads a row from a build that recorded less", () => {
    const reading = parseReading({ at: CHECKED, band: "mixed" });

    expect(reading?.adjustedRating).toBeNull();
    expect(reading?.features).toBeNull();
  });

  it("drops a feature that is not a number rather than trusting it", () => {
    const reading = parseReading({
      at: CHECKED,
      features: { "temporalBurst.largestBurstShare": "a lot" },
    });

    expect(reading?.features).toEqual({ "temporalBurst.largestBurstShare": null });
  });
});
