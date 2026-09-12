import { describe, expect, it, vi } from "vitest";
import type { RulesDocument } from "../extract/rules";
import { STORAGE_MESSAGE_TYPE } from "./messages";
import {
  NOTHING_ENABLED,
  queueContributionEdges,
  readRules,
  readSettings,
  reviewsCacheVia,
  saveHistoryEntry,
} from "./viaBackground";

const BUNDLED: RulesDocument = {
  version: 1,
  site: "amazon",
  locales: ["com"],
  fields: { title: { strategy: "selector", value: "h1" } },
};

const ENABLED = {
  historyEnabled: true,
  reputationLookupEnabled: true,
  graphContributionEnabled: true,
};

describe("what the content script asks the background for", () => {
  it("returns the settings the background reports", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, value: ENABLED });
    await expect(readSettings(send)).resolves.toEqual(ENABLED);
  });

  it("sends the entry to save rather than writing it where the page can read it", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, value: null });
    const entry = {
      title: "a product",
      thumbnailUrl: null,
      report: {},
      featureVector: {} as never,
      productKey: "k",
    };
    await saveHistoryEntry(entry, send);

    expect(send).toHaveBeenCalledWith({ type: STORAGE_MESSAGE_TYPE, op: "history-add", entry });
  });

  it("sends contribution edges rather than queueing them in the page's own database", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, value: null });
    const edges = [{ reviewerHash: "a", productHash: "b", starRating: 5, weekBucket: 1, verified: true, minhashSignature: [] }];
    await queueContributionEdges(edges, send);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ op: "contribution-enqueue", edges }),
    );
  });
});

describe("when the background cannot be reached", () => {
  it("runs nothing at all rather than guessing at consent", async () => {
    const send = vi.fn().mockRejectedValue(new Error("no receiver"));
    await expect(readSettings(send)).resolves.toEqual(NOTHING_ENABLED);
  });

  it("treats a refusal the same way", async () => {
    const send = vi.fn().mockResolvedValue({ ok: false });
    await expect(readSettings(send)).resolves.toEqual(NOTHING_ENABLED);
  });

  it("treats no answer at all the same way", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await expect(readSettings(send)).resolves.toEqual(NOTHING_ENABLED);
  });

  it("falls back to the bundled rules so the page is still read", async () => {
    const send = vi.fn().mockRejectedValue(new Error("no receiver"));
    await expect(readRules("amazon", BUNDLED, send)).resolves.toEqual(BUNDLED);
  });

  it("reports an empty cache rather than failing the deep check", async () => {
    const send = vi.fn().mockRejectedValue(new Error("no receiver"));
    await expect(reviewsCacheVia(send).read("p-1", "amazon")).resolves.toBeNull();
  });
});

describe("the reviews cache the content script sees", () => {
  it("hydrates signatures from the record the background returned", async () => {
    const record = {
      key: "k",
      cachedAt: Date.now(),
      pagesFetched: 3,
      shingleSize: 1,
      numPermutations: 1,
      embeddingDimensions: 1,
      reviews: [
        {
          rating: 4,
          date: "2026-01-01",
          verified: true,
          reviewerId: "r-1",
          textSignature: ["7"],
          textTermCounts: null,
        },
      ],
    };
    const send = vi.fn().mockResolvedValue({ ok: true, value: record });

    const cached = await reviewsCacheVia(send).read("p-1", "amazon");

    expect(cached?.pagesFetched).toBe(3);
    expect(cached?.signatures.get(cached.reviews[0] as never)).toEqual([7n]);
  });

  it("sends signatures rather than review text, so no text crosses", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, value: null });
    await reviewsCacheVia(send).write(
      "p-1",
      "amazon",
      [{ rating: 5, text: "a review with several words in it", date: null, verified: null, reviewerId: "r-1" }],
      1,
    );

    const sent = JSON.stringify(send.mock.calls[0]?.[0]);
    expect(sent).not.toContain("several words");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ op: "reviews-put", pagesFetched: 1 }));
  });
});
