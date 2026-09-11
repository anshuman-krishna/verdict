// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../../storage/history";
import { entryForSerial } from "./main";

function entry(id: number, serial: string): HistoryEntry {
  return {
    id,
    timestamp: 0,
    title: `product ${id}`,
    thumbnailUrl: null,
    report: {
      serial,
      band: "mixed",
      claimedRating: 4.5,
      adjustedRating: 3.9,
      totalReviewCount: 100,
      excludedReviewCount: 20,
      estimatedInorganicShare: 0.2,
      confidence: { low: 0.1, high: 0.3 },
      evidence: [],
      unavailableSignals: [],
      generatedAt: 0,
    },
  };
}

const ENTRIES = [entry(1, "AAAA-1111"), entry(2, "BBBB-2222")];

describe("the report the panel asked the popup to open", () => {
  it("finds the entry whose serial the panel quoted", () => {
    expect(entryForSerial(ENTRIES, "#BBBB-2222")?.id).toBe(2);
  });

  it("accepts a serial that arrived percent encoded", () => {
    expect(entryForSerial(ENTRIES, "#BBBB%2D2222")?.id).toBe(2);
  });

  it("accepts a serial typed in lower case", () => {
    expect(entryForSerial(ENTRIES, "#bbbb-2222")?.id).toBe(2);
  });

  it("opens the list when there is no hash at all", () => {
    expect(entryForSerial(ENTRIES, "")).toBeNull();
    expect(entryForSerial(ENTRIES, "#")).toBeNull();
  });

  it("opens the list when the serial names nothing stored", () => {
    expect(entryForSerial(ENTRIES, "#ZZZZ-9999")).toBeNull();
  });

  it("opens the list rather than throwing on a hash that will not decode", () => {
    expect(() => entryForSerial(ENTRIES, "#%E0%A4%A")).not.toThrow();
  });

  it("skips an entry whose stored report cannot be read", () => {
    const legacy: HistoryEntry = { ...entry(3, ""), report: "not an object" };
    expect(entryForSerial([legacy], "#AAAA-1111")).toBeNull();
  });
});
