import { describe, expect, it } from "vitest";
import {
  BAND_COLORS,
  BAND_LABELS,
  generateSerial,
  parseStoredReport,
  summarizeReport,
} from "./report";

describe("generateSerial", () => {
  it("is deterministic for the same seed and timestamp", () => {
    expect(generateSerial("https://amazon.com/dp/B000X", 1_700_000_000_000)).toBe(
      generateSerial("https://amazon.com/dp/B000X", 1_700_000_000_000),
    );
  });

  it("differs when the timestamp differs, even for the same seed", () => {
    expect(generateSerial("https://amazon.com/dp/B000X", 1)).not.toBe(
      generateSerial("https://amazon.com/dp/B000X", 2),
    );
  });

  it("differs when the seed differs, even for the same timestamp", () => {
    expect(generateSerial("product a", 1)).not.toBe(generateSerial("product b", 1));
  });

  it("matches the XXXX-XXXX shape from the design mockup", () => {
    expect(generateSerial("https://amazon.com/dp/B000X", 1_700_000_000_000)).toMatch(
      /^[0-9A-Z]{4}-[0-9A-Z]{4}$/,
    );
  });
});

describe("summarizeReport", () => {
  it("extracts every known field from a well formed report", () => {
    expect(
      summarizeReport({
        band: "mixed",
        claimedRating: 4.6,
        adjustedRating: 3.9,
        estimatedInorganicShare: 0.14,
      }),
    ).toEqual({ band: "mixed", claimedRating: 4.6, adjustedRating: 3.9, estimatedInorganicShare: 0.14 });
  });

  it("summarizes a non object, or a report with none of the known fields, as all nulls", () => {
    const allNull = {
      band: null,
      claimedRating: null,
      adjustedRating: null,
      estimatedInorganicShare: null,
    };
    expect(summarizeReport(null)).toEqual(allNull);
    expect(summarizeReport("not a report")).toEqual(allNull);
    expect(summarizeReport({})).toEqual(allNull);
  });

  it("rejects a band string outside the known set rather than passing it through", () => {
    expect(summarizeReport({ band: "not-a-real-band" }).band).toBeNull();
  });
});

describe("band tables", () => {
  it("has a label and a colour for every band", () => {
    const bands = Object.keys(BAND_LABELS) as (keyof typeof BAND_LABELS)[];
    for (const band of bands) {
      expect(BAND_LABELS[band].length).toBeGreaterThan(0);
      expect(BAND_COLORS[band]).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe("parseStoredReport", () => {
  const stored = {
    serial: "7QK2-M4P9",
    band: "mixed",
    claimedRating: 4.6,
    adjustedRating: 3.9,
    totalReviewCount: 120,
    excludedReviewCount: 30,
    estimatedInorganicShare: 0.25,
    confidence: { low: 0.18, high: 0.33 },
    evidence: [
      { signal: "arrival timing", strength: "moderate", detail: "two bursts.", value: 0.12 },
    ],
    unavailableSignals: ["reviewer network"],
    generatedAt: 1_700_000_000_000,
  };

  it("round trips a report the extension wrote", () => {
    expect(parseStoredReport(stored)).toEqual(stored);
  });

  it("refuses anything that is not an object", () => {
    for (const value of [null, "a report", 7, undefined]) {
      expect(parseStoredReport(value)).toBeNull();
    }
  });

  it("refuses a report missing a field the view would read", () => {
    for (const key of [
      "band",
      "claimedRating",
      "adjustedRating",
      "estimatedInorganicShare",
      "totalReviewCount",
      "excludedReviewCount",
      "generatedAt",
      "confidence",
      "evidence",
    ]) {
      const partial: Record<string, unknown> = { ...stored };
      delete partial[key];
      expect(parseStoredReport(partial)).toBeNull();
    }
  });

  it("refuses a band this build does not know", () => {
    expect(parseStoredReport({ ...stored, band: "catastrophic" })).toBeNull();
  });

  it("refuses a rating that is not a finite number", () => {
    expect(parseStoredReport({ ...stored, adjustedRating: Number.NaN })).toBeNull();
  });

  it("drops an evidence row it cannot read rather than the whole report", () => {
    const parsed = parseStoredReport({
      ...stored,
      evidence: [...stored.evidence, { signal: "later signal", strength: "unknown to us" }],
    });
    expect(parsed?.evidence).toHaveLength(1);
  });

  it("reads a report with no unavailable signals recorded at all", () => {
    const partial: Record<string, unknown> = { ...stored };
    delete partial.unavailableSignals;
    expect(parseStoredReport(partial)?.unavailableSignals).toEqual([]);
  });

  it("reads a report written before serials existed", () => {
    const partial: Record<string, unknown> = { ...stored };
    delete partial.serial;
    expect(parseStoredReport(partial)?.serial).toBe("");
  });
});

describe("what summarizeReport counts as a number", () => {
  it("reports nothing rather than a figure no interface can render", () => {
    const summary = summarizeReport({ band: "mixed", adjustedRating: Number.NaN });
    expect(summary.adjustedRating).toBeNull();
  });

  it("reports nothing for an infinite share", () => {
    expect(summarizeReport({ estimatedInorganicShare: Infinity }).estimatedInorganicShare).toBeNull();
  });
});
