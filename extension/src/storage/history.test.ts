import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  addHistoryEntry,
  deleteAllHistory,
  exportHistoryAsCsv,
  exportHistoryAsJson,
  listHistory,
} from "./history";
import type { FeatureVector } from "../score/featureVector";

const VECTOR: FeatureVector = {
  meetsMinimumData: true,
  ratingDeconvolution: { injectedShare: 0.4, residualError: 0.02 },
  temporalBurst: { bursts: [], burstFraction: 0, burstCount: 0, largestBurstShare: 0 },
  verificationConcentration: { lift: 1.2, baseCount: 8 },
  textNearDuplication: { duplicateReviewShare: 0, clusterCount: 0, largestClusterShare: 0 },
  listingDrift: {
    offTopicShare: null,
    offTopicCount: 0,
    meanDistance: null,
    changePoint: null,
    driftStatistic: 0,
    embeddedCount: 0,
  },
  reviewerGraph: null,
};

describe("history", () => {
  it("starts empty", async () => {
    await expect(listHistory()).resolves.toEqual([]);
  });

  it("lists entries most recent first", async () => {
    await addHistoryEntry({ title: "first", thumbnailUrl: null, report: { band: "clean" } });
    await addHistoryEntry({ title: "second", thumbnailUrl: null, report: { band: "mixed" } });
    const entries = await listHistory();
    expect(entries.map((entry) => entry.title)).toEqual(["second", "first"]);
  });

  it("deleteAllHistory clears every entry", async () => {
    await addHistoryEntry({ title: "will be deleted", thumbnailUrl: null, report: {} });
    await deleteAllHistory();
    await expect(listHistory()).resolves.toEqual([]);
  });

  it("evicts the oldest entries once the cap is exceeded", async () => {
    await deleteAllHistory();
    for (let i = 0; i < 502; i++) {
      await addHistoryEntry({ title: `entry ${i}`, thumbnailUrl: null, report: {} });
    }
    const entries = await listHistory();
    expect(entries).toHaveLength(500);
    expect(entries.some((entry) => entry.title === "entry 0")).toBe(false);
    expect(entries.some((entry) => entry.title === "entry 501")).toBe(true);
  }, 20000);

  it("exports as json round tripping every field", async () => {
    await deleteAllHistory();
    await addHistoryEntry({ title: "exportable", thumbnailUrl: "https://x/y.jpg", report: { band: "clean" } });
    const json = await exportHistoryAsJson();
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([
      {
        id: expect.any(Number),
        title: "exportable",
        thumbnailUrl: "https://x/y.jpg",
        report: { band: "clean" },
        timestamp: expect.any(Number),
      },
    ]);
  });

  it("exports as csv with a header and one row per entry", async () => {
    await deleteAllHistory();
    await addHistoryEntry({ title: "plain", thumbnailUrl: null, report: {} });
    await addHistoryEntry({ title: "has, a comma", thumbnailUrl: null, report: {} });
    const csv = await exportHistoryAsCsv();
    const lines = csv.split("\n");
    expect(lines[0]).toBe("timestamp,title,band,estimatedInorganicShare,thumbnailUrl");
    expect(lines).toHaveLength(3);
    expect(lines.some((line) => line.includes('"has, a comma"'))).toBe(true);
  });
  it("carries the band and the share into the csv, since a title alone judges nothing", async () => {
    await addHistoryEntry({
      title: "scored",
      thumbnailUrl: null,
      report: {
        band: "doubtful",
        claimedRating: 4.6,
        adjustedRating: 3.8,
        estimatedInorganicShare: 0.42,
      },
    });

    const line = (await exportHistoryAsCsv()).split("\n")[1];

    expect(line).toContain("doubtful");
    expect(line).toContain("0.42");
  });

  it("leaves the band empty for an entry whose report it cannot read", async () => {
    await addHistoryEntry({ title: "legacy", thumbnailUrl: null, report: null });

    expect((await exportHistoryAsCsv()).split("\n")[1]).toMatch(/^\d+,legacy,,,$/);
  });

  it("round trips a stored feature vector", async () => {
    await addHistoryEntry({
      title: "vectored",
      thumbnailUrl: null,
      report: { band: "clean" },
      featureVector: VECTOR,
    });

    expect((await listHistory())[0]?.featureVector).toEqual(VECTOR);
  });
});
