import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  addHistoryEntry,
  countHistory,
  deleteAllHistory,
  exportHistoryAsCsv,
  exportHistoryAsJson,
  listChecksOfProduct,
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

  describe("a csv export is opened in a spreadsheet", () => {
    it("disarms a title a spreadsheet would run as a formula", async () => {
      await deleteAllHistory();
      for (const title of ["=1+1", "+1+1", "-1+1", "@SUM(A1)", "=cmd|'/c calc'!A1"]) {
        await addHistoryEntry({ title, thumbnailUrl: null, report: null });
      }

      const rows = (await exportHistoryAsCsv()).split("\n").slice(1);
      for (const row of rows) {
        const title = row.split(",").slice(1).join(",");
        expect(title.startsWith(`"'`)).toBe(true);
      }
    });

    it("keeps the original text readable once the cell is text", async () => {
      await deleteAllHistory();
      await addHistoryEntry({ title: "=1+1", thumbnailUrl: null, report: null });

      const row = (await exportHistoryAsCsv()).split("\n")[1] as string;
      expect(row).toContain(`"'=1+1"`);
    });

    it("leaves an ordinary title unquoted and unchanged", async () => {
      await deleteAllHistory();
      await addHistoryEntry({ title: "wireless mouse", thumbnailUrl: null, report: null });

      const row = (await exportHistoryAsCsv()).split("\n")[1] as string;
      expect(row).toContain(",wireless mouse,");
    });

    it("quotes a title carrying a carriage return, so it cannot start a new row", async () => {
      await deleteAllHistory();
      await addHistoryEntry({ title: "one\rtwo", thumbnailUrl: null, report: null });

      const csv = await exportHistoryAsCsv();
      expect(csv.split("\n")).toHaveLength(2);
      expect(csv).toContain(`"one\rtwo"`);
    });
  });
});

describe("the checks of one listing", () => {
  const report = { band: "mixed", adjustedRating: 3.9 };

  it("returns every check of that product, newest first", async () => {
    await deleteAllHistory();
    await addHistoryEntry({ title: "a", thumbnailUrl: null, report, productKey: "k1" });
    await addHistoryEntry({ title: "a", thumbnailUrl: null, report, productKey: "k1" });
    await addHistoryEntry({ title: "b", thumbnailUrl: null, report, productKey: "k2" });

    const checks = await listChecksOfProduct("k1");

    expect(checks).toHaveLength(2);
    expect(checks[0]?.timestamp).toBeGreaterThanOrEqual(checks[1]?.timestamp as number);
  });

  it("carries the band and rating of each one", async () => {
    await deleteAllHistory();
    await addHistoryEntry({ title: "a", thumbnailUrl: null, report, productKey: "k1" });

    expect(await listChecksOfProduct("k1")).toEqual([
      { timestamp: expect.any(Number), band: "mixed", adjustedRating: 3.9 },
    ]);
  });

  it("returns nothing for a product with no checks", async () => {
    await deleteAllHistory();
    await expect(listChecksOfProduct("nothing-here")).resolves.toEqual([]);
  });

  it("returns nothing rather than everything for an empty key", async () => {
    await deleteAllHistory();
    await addHistoryEntry({ title: "a", thumbnailUrl: null, report, productKey: "k1" });
    await expect(listChecksOfProduct("")).resolves.toEqual([]);
  });

  it("never matches an entry written before the key existed", async () => {
    await deleteAllHistory();
    await addHistoryEntry({ title: "a", thumbnailUrl: null, report });
    await expect(listChecksOfProduct("k1")).resolves.toEqual([]);
  });

  it("takes only the checks before a given moment, so a report excludes itself", async () => {
    await deleteAllHistory();
    await addHistoryEntry({ title: "a", thumbnailUrl: null, report, productKey: "k1" });
    const [entry] = await listHistory();

    await expect(listChecksOfProduct("k1", entry?.timestamp)).resolves.toEqual([]);
  });

  it("reports a band of null for a check whose report cannot be read", async () => {
    await deleteAllHistory();
    await addHistoryEntry({
      title: "a",
      thumbnailUrl: null,
      report: "not an object",
      productKey: "k1",
    });

    expect((await listChecksOfProduct("k1"))[0]?.band).toBeNull();
  });
});

describe("countHistory", () => {
  it("counts nothing on an empty history", async () => {
    await deleteAllHistory();
    await expect(countHistory()).resolves.toBe(0);
  });

  it("agrees with what listHistory returns", async () => {
    await deleteAllHistory();
    await addHistoryEntry({ title: "a", thumbnailUrl: null, report: null });
    await addHistoryEntry({ title: "b", thumbnailUrl: null, report: null });

    expect(await countHistory()).toBe((await listHistory()).length);
  });
});
