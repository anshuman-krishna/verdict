import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  addHistoryEntry,
  deleteAllHistory,
  exportHistoryAsCsv,
  exportHistoryAsJson,
  listHistory,
} from "./history";

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
    expect(lines[0]).toBe("timestamp,title,thumbnailUrl");
    expect(lines).toHaveLength(3);
    expect(lines.some((line) => line.includes('"has, a comma"'))).toBe(true);
  });
});
