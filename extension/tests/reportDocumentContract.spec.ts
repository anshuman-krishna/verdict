import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { FeatureVector } from "../src/score/featureVector";
import type { Report } from "../src/score/report";
import { reportDocument, REPORT_DOCUMENT_VERSION } from "../src/score/reportDocument";

// the seller side of SITE.md /sellers: the extension writes this document and
// research/verdict_research/dispute reads it. neither side may change it alone, so both
// check themselves against this one file, the way tests/contract/ does for the service
const CONTRACT = resolve(import.meta.dirname, "..", "..", "tests", "contract", "reportDocument.json");

const CHECKED = Date.parse("2026-02-14T09:00:00Z");
const EXPORTED = Date.parse("2026-03-01T12:00:00Z");
const TRAINED = Date.parse("2026-01-05T00:00:00Z");

const REPORT: Report = {
  serial: "7F2A-0091",
  band: "mixed",
  probability: 0.4212,
  claimedRating: 4.6,
  adjustedRating: 3.9,
  totalReviewCount: 8431,
  excludedReviewCount: 1208,
  estimatedInorganicShare: 0.1433,
  confidence: { low: 0.11, high: 0.24 },
  evidence: [
    {
      signal: "rating shape",
      strength: "moderate",
      detail: "The rating distribution is consistent with about 14 percent of reviews being added outside the organic pattern.",
      value: 0.1433,
    },
  ],
  unavailableSignals: ["reviewer network"],
  absentSignals: ["verification pattern"],
  generatedAt: CHECKED,
  provenance: {
    extensionVersion: "0.1.0",
    rulesVersion: 41,
    rulesSite: "amazon",
    modelTrainedAt: TRAINED,
    modelDigest: "7KQ2M4XZ",
    priorsKey: "home-kitchen",
    embedding: "hashed-terms/256",
    signals: ["rating shape", "arrival timing"],
  },
};

const VECTOR = {
  meetsMinimumData: true,
  ratingDeconvolution: { injectedShare: 0.1433, residualError: 0.0121 },
  temporalBurst: { burstFraction: 0.31, burstCount: 2, largestBurstShare: 0.19 },
  verificationConcentration: null,
  textNearDuplication: { duplicateReviewShare: 0.07, clusterCount: 3, largestClusterShare: 0.04 },
  listingDrift: { offTopicShare: 0.02, meanDistance: 0.61, driftStatistic: 0.33 },
  reviewerGraph: null,
} as unknown as FeatureVector;

describe("the report document a seller is asked to send", () => {
  const committed = JSON.parse(readFileSync(CONTRACT, "utf8")) as Record<string, unknown>;

  it("is exactly what this build writes", () => {
    expect(reportDocument(REPORT, "Stovetop Kettle, 1.7 Litre", EXPORTED, VECTOR)).toEqual(
      committed,
    );
  });

  it("is stamped with the version both sides read", () => {
    expect(committed.documentVersion).toBe(REPORT_DOCUMENT_VERSION);
  });

  it("carries the probability, without which a rerun has nothing to check", () => {
    expect((committed.report as Record<string, unknown>).probability).toBe(REPORT.probability);
  });

  it("carries the features flat, under the keys the model names its coefficients with", () => {
    expect(committed.features).toMatchObject({
      "ratingDeconvolution.injectedShare": 0.1433,
      "verificationConcentration.lift": null,
    });
  });
});
