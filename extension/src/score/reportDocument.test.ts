import { describe, expect, it } from "vitest";
import type { Report, ReportProvenance } from "./report";
import {
  provenanceLines,
  reportAsText,
  reportDocument,
  reportDocumentJson,
  reportFilename,
  REPORT_DOCUMENT_VERSION,
} from "./reportDocument";

const CHECKED = Date.parse("2026-02-14T09:00:00Z");
const EXPORTED = Date.parse("2026-03-01T12:00:00Z");
const TRAINED = Date.parse("2026-01-05T00:00:00Z");

const PROVENANCE: ReportProvenance = {
  extensionVersion: "0.1.0",
  rulesVersion: 41,
  rulesSite: "amazon",
  modelTrainedAt: TRAINED,
  modelDigest: "7KQ2M4XZ",
  signals: ["rating shape", "arrival timing"],
};

function report(overrides: Partial<Report> = {}): Report {
  return {
    serial: "ABCD-1234",
    band: "mixed",
    claimedRating: 4.4,
    adjustedRating: 3.9,
    totalReviewCount: 820,
    excludedReviewCount: 123,
    estimatedInorganicShare: 0.15,
    confidence: { low: 0.11, high: 0.24 },
    evidence: [
      {
        signal: "rating shape",
        strength: "moderate",
        detail: "The rating distribution is consistent with about 15 percent of reviews being added outside the organic pattern.",
        value: 0.15,
      },
    ],
    unavailableSignals: [],
    generatedAt: CHECKED,
    provenance: PROVENANCE,
    ...overrides,
  };
}

describe("reportFilename", () => {
  it("names the file after the serial, so a dispute can be matched to a report", () => {
    expect(reportFilename(report(), "txt")).toBe("verdict-report-abcd-1234.txt");
    expect(reportFilename(report(), "json")).toBe("verdict-report-abcd-1234.json");
  });

  it("still produces a filename when a report carries no serial", () => {
    expect(reportFilename(report({ serial: "" }), "txt")).toBe("verdict-report-unserialled.txt");
  });
});

describe("reportDocument", () => {
  it("stamps a version, so a reader knows what shape it is holding", () => {
    const document_ = reportDocument(report(), "a product", EXPORTED);
    expect(document_.documentVersion).toBe(REPORT_DOCUMENT_VERSION);
    expect(document_.exportedAt).toBe(EXPORTED);
    expect(document_.title).toBe("a product");
  });

  it("carries the whole report, provenance included, so it can be run again", () => {
    const json = JSON.parse(reportDocumentJson(report(), "a product", EXPORTED));
    expect(json.report.provenance).toEqual(PROVENANCE);
    expect(json.report.evidence).toHaveLength(1);
  });
});

describe("provenanceLines", () => {
  it("names the build, the rules, the model and what it weighed", () => {
    const lines = provenanceLines(PROVENANCE).join("\n");
    expect(lines).toContain("Verdict version: 0.1.0");
    expect(lines).toContain("amazon rules version 41");
    expect(lines).toContain("7KQ2M4XZ");
    expect(lines).toContain("rating shape, arrival timing");
  });

  it("says so plainly when an older build recorded nothing", () => {
    expect(provenanceLines(undefined).join(" ")).toContain("Not recorded");
  });

  it("does not invent a training date it was not given", () => {
    const lines = provenanceLines({ ...PROVENANCE, modelTrainedAt: null, modelDigest: null });
    expect(lines.join(" ")).toContain("not recorded");
  });

  it("says when no signal was recorded rather than showing an empty list", () => {
    expect(provenanceLines({ ...PROVENANCE, signals: [] }).join(" ")).toContain("none recorded");
  });
});

describe("reportAsText", () => {
  const text = reportAsText(report(), "a product", EXPORTED);

  it("leads with the serial and the listing", () => {
    expect(text).toContain("Serial: ABCD-1234");
    expect(text).toContain("Listing: a product");
  });

  it("gives every figure the panel gives", () => {
    expect(text).toContain("Reading: mixed");
    expect(text).toContain("Claimed rating: 4.4");
    expect(text).toContain("Adjusted rating: 3.9");
    expect(text).toContain("Reviews kept: 697");
    expect(text).toContain("Reviews excluded: 123");
    expect(text).toContain("Estimate range: 11 to 24 percent");
  });

  it("gives each signal its sentence and its number", () => {
    expect(text).toContain("rating shape: moderate");
    expect(text).toContain("consistent with about 15 percent");
    expect(text).toContain("measured: 0.15");
  });

  it("records what produced it", () => {
    expect(text).toContain("HOW THIS WAS PRODUCED");
    expect(text).toContain("rules version 41");
  });

  it("tells a seller where to take it", () => {
    expect(text).toContain("verdict.tools/sellers");
  });

  it("never accuses anyone", () => {
    expect(text).not.toMatch(/fake|fraud|scam|lying/i);
  });

  it("carries no em dash, per CLAUDE.md", () => {
    expect(text).not.toContain("—");
  });

  it("names the signals that could not be read", () => {
    const withGaps = reportAsText(
      report({ unavailableSignals: ["reviewer network"] }),
      "a product",
      EXPORTED,
    );
    expect(withGaps).toContain("COULD NOT BE READ");
    expect(withGaps).toContain("reviewer network");
  });

  it("says so when a check recorded no signals at all", () => {
    const empty = reportAsText(report({ evidence: [] }), "a product", EXPORTED);
    expect(empty).toContain("No signals were recorded for this check.");
  });

  it("reads a value of zero as a number, not as unavailable", () => {
    const zeroed = reportAsText(
      report({ evidence: [{ signal: "arrival timing", strength: "weak", detail: "d", value: 0 }] }),
      "a product",
      EXPORTED,
    );
    expect(zeroed).toContain("measured: 0");
    expect(zeroed).not.toContain("measured: not available");
  });
});
