import { describe, expect, it } from "vitest";
import { BAND_COLORS, BAND_LABELS, generateSerial, summarizeReport } from "./report";

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
