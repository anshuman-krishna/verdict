import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Report } from "../score/report";
import { addHistoryEntry, deleteAllHistory, listHistory } from "./history";
import {
  identityOf,
  importHistory,
  importResultLine,
  parseHistoryFile,
  parseImportableEntry,
} from "./importHistory";

const NOW = Date.parse("2026-03-01T12:00:00Z");
const DAY_MS = 86_400_000;

function report(overrides: Partial<Report> = {}): Report {
  return {
    serial: "ABCD-1234",
    band: "mixed",
    claimedRating: 4.4,
    adjustedRating: 3.9,
    totalReviewCount: 820,
    excludedReviewCount: 120,
    estimatedInorganicShare: 0.15,
    confidence: { low: 0.3, high: 0.5 },
    evidence: [],
    unavailableSignals: [],
    generatedAt: NOW - DAY_MS,
    ...overrides,
  };
}

function exported(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    timestamp: NOW - DAY_MS,
    title: "a product",
    thumbnailUrl: null,
    report: report(),
    productKey: "a".repeat(64),
    ...overrides,
  };
}

describe("parseImportableEntry", () => {
  it("reads an entry the exporter wrote", () => {
    const entry = parseImportableEntry(exported(), NOW);
    expect(entry?.title).toBe("a product");
    expect(entry?.report.serial).toBe("ABCD-1234");
    expect(entry?.productKey).toBe("a".repeat(64));
  });

  it("drops the exported id, so nothing already here is overwritten", () => {
    expect(parseImportableEntry(exported(), NOW)).not.toHaveProperty("id");
  });

  it("refuses an entry whose report cannot be read", () => {
    expect(parseImportableEntry(exported({ report: { band: "mixed" } }), NOW)).toBeNull();
  });

  it("refuses a timestamp far enough ahead to pin itself to the top of the list", () => {
    expect(parseImportableEntry(exported({ timestamp: NOW + 400 * DAY_MS }), NOW)).toBeNull();
  });

  it("allows a timestamp a few hours ahead, which is a clock rather than a claim", () => {
    expect(parseImportableEntry(exported({ timestamp: NOW + 3_600_000 }), NOW)).not.toBeNull();
  });

  it("refuses a timestamp that is not a number", () => {
    expect(parseImportableEntry(exported({ timestamp: "yesterday" }), NOW)).toBeNull();
    expect(parseImportableEntry(exported({ timestamp: 0 }), NOW)).toBeNull();
  });

  it("drops a thumbnail url that is not a storefront image", () => {
    const entry = parseImportableEntry(
      exported({ thumbnailUrl: "javascript:alert(1)" }),
      NOW,
    );
    expect(entry?.thumbnailUrl).toBeNull();
  });

  it("drops a product key that is not the hash the cache is keyed by", () => {
    const entry = parseImportableEntry(exported({ productKey: "everything" }), NOW);
    expect(entry?.productKey).toBeNull();
  });

  it("truncates a title long enough to be a payload rather than a name", () => {
    const entry = parseImportableEntry(exported({ title: "x".repeat(5000) }), NOW);
    expect(entry?.title).toHaveLength(300);
  });

  it("keeps a feature vector that parses", () => {
    const vector = {
      meetsMinimumData: true,
      ratingDeconvolution: { injectedShare: 0.2, residualError: 0.01 },
      temporalBurst: null,
      verificationConcentration: null,
      textNearDuplication: {
        duplicateReviewShare: 0.1,
        clusterCount: 2,
        largestClusterShare: 0.05,
      },
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
    const entry = parseImportableEntry(exported({ featureVector: vector }), NOW);
    expect(entry?.featureVector?.ratingDeconvolution?.injectedShare).toBe(0.2);
  });

  it("keeps the check but drops a feature vector that does not parse", () => {
    const entry = parseImportableEntry(
      exported({ featureVector: { meetsMinimumData: true, textNearDuplication: null } }),
      NOW,
    );
    expect(entry).not.toBeNull();
    expect(entry?.featureVector).toBeUndefined();
  });
});

describe("parseHistoryFile", () => {
  it("refuses something that is not json", () => {
    expect(parseHistoryFile("not json at all", NOW)).toEqual({ status: "not-json" });
  });

  it("refuses json that is not the exported array", () => {
    expect(parseHistoryFile('{"entries":[]}', NOW)).toEqual({ status: "not-a-history-export" });
  });

  it("counts what it could not read rather than failing the whole file", () => {
    const parsed = parseHistoryFile(JSON.stringify([exported(), { nonsense: true }]), NOW);
    expect(parsed).toEqual({ entries: [expect.anything()], rejected: 1 });
  });

  it("accepts an empty export", () => {
    expect(parseHistoryFile("[]", NOW)).toEqual({ entries: [], rejected: 0 });
  });
});

describe("identityOf", () => {
  it("uses the serial when there is one", () => {
    expect(identityOf({ report: report(), timestamp: 1, title: "a" })).toBe("serial:ABCD-1234");
  });

  it("falls back to the stamp and title when a report carries no serial", () => {
    expect(identityOf({ report: report({ serial: "" }), timestamp: 5, title: "a" })).toBe(
      "stamp:5:a",
    );
  });
});

describe("importHistory", () => {
  beforeEach(async () => {
    await deleteAllHistory();
  });

  it("adds what is in the file", async () => {
    const outcome = await importHistory(JSON.stringify([exported()]), NOW);
    expect(outcome).toEqual({
      status: "ok",
      summary: { added: 1, duplicates: 0, rejected: 0, skipped: 0 },
    });
    await expect(listHistory()).resolves.toHaveLength(1);
  });

  it("merges rather than replaces", async () => {
    await addHistoryEntry({
      title: "already here",
      thumbnailUrl: null,
      report: report({ serial: "ZZZZ-9999" }),
    });
    await importHistory(JSON.stringify([exported()]), NOW);
    const titles = (await listHistory()).map((entry) => entry.title);
    expect(titles).toContain("already here");
    expect(titles).toContain("a product");
  });

  it("does not double anything when the same file is imported twice", async () => {
    const file = JSON.stringify([exported()]);
    await importHistory(file, NOW);
    const second = await importHistory(file, NOW);
    expect(second).toEqual({
      status: "ok",
      summary: { added: 0, duplicates: 1, rejected: 0, skipped: 0 },
    });
    await expect(listHistory()).resolves.toHaveLength(1);
  });

  it("deduplicates within one file too", async () => {
    const outcome = await importHistory(JSON.stringify([exported(), exported()]), NOW);
    expect(outcome).toMatchObject({ summary: { added: 1, duplicates: 1 } });
  });

  it("does not overwrite an entry that happens to share the exported id", async () => {
    await addHistoryEntry({
      title: "already here",
      thumbnailUrl: null,
      report: report({ serial: "ZZZZ-9999" }),
    });
    const [existing] = await listHistory();
    await importHistory(JSON.stringify([exported({ id: existing?.id })]), NOW);
    await expect(listHistory()).resolves.toHaveLength(2);
  });

  it("keeps the newest when the file is larger than the cap", async () => {
    const many = Array.from({ length: 520 }, (_, index) =>
      exported({
        timestamp: NOW - index * 1000,
        report: report({ serial: `AAAA-${index.toString().padStart(4, "0")}` }),
      }));
    const outcome = await importHistory(JSON.stringify(many), NOW);
    expect(outcome).toMatchObject({ summary: { added: 500, skipped: 20 } });
    const entries = await listHistory();
    expect(entries).toHaveLength(500);
    expect(entries[0]?.timestamp).toBe(NOW);
  });

  it("does not let an old file push out newer checks already here", async () => {
    for (let index = 0; index < 10; index++) {
      await addHistoryEntry({
        title: `recent ${index}`,
        thumbnailUrl: null,
        report: report({ serial: `NEW0-${index.toString().padStart(4, "0")}` }),
      });
    }
    const old = Array.from({ length: 495 }, (_, index) =>
      exported({
        timestamp: NOW - (index + 1) * 365 * DAY_MS,
        report: report({ serial: `OLD0-${index.toString().padStart(4, "0")}` }),
      }));
    await importHistory(JSON.stringify(old), NOW);
    const titles = (await listHistory()).map((entry) => entry.title);
    for (let index = 0; index < 10; index++) {
      expect(titles).toContain(`recent ${index}`);
    }
  });

  it("reports a file it cannot read without touching history", async () => {
    await expect(importHistory("not json", NOW)).resolves.toEqual({ status: "not-json" });
    await expect(listHistory()).resolves.toHaveLength(0);
  });
});

describe("importResultLine", () => {
  it("says what arrived", () => {
    expect(
      importResultLine({
        status: "ok",
        summary: { added: 23, duplicates: 0, rejected: 0, skipped: 0 },
      }),
    ).toBe("Added 23 checks.");
  });

  it("says when a file held nothing new", () => {
    expect(
      importResultLine({
        status: "ok",
        summary: { added: 0, duplicates: 4, rejected: 0, skipped: 0 },
      }),
    ).toBe("Nothing new in that file. 4 checks were already here.");
  });

  it("counts one of a thing in the singular", () => {
    expect(
      importResultLine({
        status: "ok",
        summary: { added: 1, duplicates: 1, rejected: 1, skipped: 0 },
      }),
    ).toBe("Added 1 check. 1 check was already here. 1 entry could not be read.");
  });

  it("names the cap when a file was larger than it", () => {
    expect(
      importResultLine({
        status: "ok",
        summary: { added: 500, duplicates: 0, rejected: 0, skipped: 20 },
      }),
    ).toContain("20 checks were beyond the 500 this browser keeps.");
  });

  it("says plainly when storage ran out", () => {
    expect(
      importResultLine({
        status: "quota-exceeded",
        summary: { added: 12, duplicates: 0, rejected: 0, skipped: 0 },
      }),
    ).toBe("Storage filled up after 12 checks.");
  });

  it("names the two ways a file can be wrong", () => {
    expect(importResultLine({ status: "not-json" })).toBe("That file is not JSON.");
    expect(importResultLine({ status: "not-a-history-export" })).toBe(
      "That file is not a Verdict history export.",
    );
  });
});
