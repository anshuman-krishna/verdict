import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RulesDocument } from "../extract/rules";
import { STORAGE_MESSAGE_TYPE, type StorageRequest } from "./messages";
import { deleteAllHistory, listHistory } from "./history";
import { countQueuedContributions, deleteContributions, listDueContributions } from "../graph/queue";
import { isOurContentScript, serveStorageRequest } from "./serveStorage";
import { deleteAllWatchlist, listWatchlist } from "./watchlist";
import {
  setGraphContributionEnabled,
  setHistoryEnabled,
  setReputationLookupEnabled,
} from "./settings";

const RULES: RulesDocument = {
  version: 1,
  site: "amazon",
  locales: ["com"],
  fields: { title: { strategy: "selector", value: "h1" } },
};

const DEPS = { rules: async () => RULES, hosts: ["www.amazon.com"] };

const STOREFRONT = { tab: { id: 7 }, url: "https://www.amazon.com/dp/B0ABCDEF12" };

function request(op: StorageRequest["op"], rest: Record<string, unknown> = {}): unknown {
  return { type: STORAGE_MESSAGE_TYPE, op, ...rest };
}

const entry = {
  title: "a product",
  thumbnailUrl: null,
  report: { estimatedInorganicShare: 0.1 },
  featureVector: {} as never,
};

const edge = {
  reviewerHash: "a".repeat(64),
  productHash: "b".repeat(64),
  starRating: 5,
  weekBucket: 2800,
  verified: true,
  minhashSignature: [],
};

async function clearQueue(): Promise<void> {
  const due = await listDueContributions(10_000_000_000_000);
  await deleteContributions(due.map((item) => item.id));
}

beforeEach(async () => {
  await deleteAllHistory();
  await clearQueue();
});

describe("who the background will answer", () => {
  it("answers our content script on a supported storefront", () => {
    expect(isOurContentScript(STOREFRONT, ["www.amazon.com"])).toBe(true);
  });

  it("refuses a sender with no tab, which is how an extension page arrives", () => {
    expect(isOurContentScript({ url: STOREFRONT.url }, ["www.amazon.com"])).toBe(false);
  });

  it("refuses a host we do not support", () => {
    expect(isOurContentScript({ tab: { id: 7 }, url: "https://evil.example/" }, ["www.amazon.com"]))
      .toBe(false);
  });

  it("refuses http, since a storefront reached over http is not the storefront", () => {
    expect(
      isOurContentScript({ tab: { id: 7 }, url: "http://www.amazon.com/dp/x" }, ["www.amazon.com"]),
    ).toBe(false);
  });

  it("refuses a sender whose url will not parse", () => {
    expect(isOurContentScript({ tab: { id: 7 }, url: "not a url" }, ["www.amazon.com"])).toBe(false);
  });

  it("returns a refusal rather than acting for an unrecognised sender", async () => {
    await setHistoryEnabled(true);
    const response = await serveStorageRequest(
      request("history-add", { entry }),
      { tab: { id: 1 }, url: "https://evil.example/" },
      DEPS,
    );

    expect(response).toEqual({ ok: false });
    expect(await listHistory()).toHaveLength(0);
  });

  it("ignores a message that is not a storage request", async () => {
    const response = await serveStorageRequest({ type: "something-else" }, STOREFRONT, DEPS);
    expect(response).toEqual({ ok: false });
  });
});

describe("what a content script may ask for", () => {
  it("reads the settings the user chose, which the page cannot see for itself", async () => {
    await setHistoryEnabled(true);
    await setReputationLookupEnabled(true);
    await setGraphContributionEnabled(false);

    const response = await serveStorageRequest(request("settings"), STOREFRONT, DEPS);

    expect(response).toEqual({
      ok: true,
      value: {
        historyEnabled: true,
        reputationLookupEnabled: true,
        graphContributionEnabled: false,
      },
    });
  });

  it("serves no operation that writes a setting, so a page cannot turn anything on", async () => {
    await setGraphContributionEnabled(false);
    const response = await serveStorageRequest(
      request("settings-set" as StorageRequest["op"], { graphContributionEnabled: true }),
      STOREFRONT,
      DEPS,
    );

    expect(response).toEqual({ ok: false });
    const after = await serveStorageRequest(request("settings"), STOREFRONT, DEPS);
    expect(after).toMatchObject({ value: { graphContributionEnabled: false } });
  });

  it("hands back the rules the background trusts for the site that asked", async () => {
    await expect(
      serveStorageRequest(request("rules", { site: "amazon" }), STOREFRONT, DEPS),
    ).resolves.toEqual({ ok: true, value: RULES });
  });

  it("asks for the site named in the request, not a site named here", async () => {
    const rules = vi.fn(async () => RULES);
    await serveStorageRequest(request("rules", { site: "ebay" }), STOREFRONT, {
      rules,
      hosts: ["www.amazon.com"],
    });
    expect(rules).toHaveBeenCalledWith("ebay");
  });

  it("refuses a site id that would become a path of its own", async () => {
    const rules = vi.fn(async () => RULES);
    for (const site of ["../../secrets", "a/b", "", "AMAZON"]) {
      await expect(
        serveStorageRequest(request("rules", { site }), STOREFRONT, {
          rules,
          hosts: ["www.amazon.com"],
        }),
      ).resolves.toEqual({ ok: false });
    }
    expect(rules).not.toHaveBeenCalled();
  });

  it("writes history into the extension's own database", async () => {
    await setHistoryEnabled(true);
    await serveStorageRequest(request("history-add", { entry }), STOREFRONT, DEPS);

    const saved = await listHistory();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.title).toBe("a product");
  });

  it("writes no history when the user turned it off, whatever the page asks", async () => {
    await setHistoryEnabled(false);
    await serveStorageRequest(request("history-add", { entry }), STOREFRONT, DEPS);

    expect(await listHistory()).toHaveLength(0);
  });

  it("queues a contribution only while the user has opted in", async () => {
    await setGraphContributionEnabled(false);
    await serveStorageRequest(request("contribution-enqueue", { edges: [edge] }), STOREFRONT, DEPS);
    expect(await countQueuedContributions()).toBe(0);

    await setGraphContributionEnabled(true);
    await serveStorageRequest(request("contribution-enqueue", { edges: [edge] }), STOREFRONT, DEPS);
    expect(await countQueuedContributions()).toBe(1);
  });

  it("round trips a cached page of reviews without carrying any text", async () => {
    const stored = {
      rating: 5,
      date: "2026-01-01",
      verified: true,
      reviewerId: "r-1",
      textSignature: null,
      textTermCounts: null,
    };
    await serveStorageRequest(
      request("reviews-put", {
        productId: "p-1",
        site: "amazon",
        reviews: [stored],
        pagesFetched: 2,
      }),
      STOREFRONT,
      DEPS,
    );

    const response = await serveStorageRequest(
      request("reviews-get", { productId: "p-1", site: "amazon" }),
      STOREFRONT,
      DEPS,
    );

    expect(response).toMatchObject({
      ok: true,
      value: { pagesFetched: 2, reviews: [stored] },
    });
  });

  it("reports a refusal rather than throwing when a store is unreachable", async () => {
    const failing = { rules: () => Promise.reject(new Error("no")), hosts: ["www.amazon.com"] };
    await expect(
      serveStorageRequest(request("rules", { site: "amazon" }), STOREFRONT, failing),
    ).resolves.toEqual({ ok: false });
  });
});

describe("settings the content script reads", () => {
  it("does not reach indexeddb from the page's side at all", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, value: RULES });
    const { readRules } = await import("./viaBackground");
    await readRules("amazon", { ...RULES, version: 99 }, send);

    expect(send).toHaveBeenCalledWith({
      type: STORAGE_MESSAGE_TYPE,
      op: "rules",
      site: "amazon",
    });
  });
});

describe("the earlier checks of one listing", () => {
  it("returns only the checks of the listing that was asked for", async () => {
    await setHistoryEnabled(true);
    await serveStorageRequest(
      request("history-add", { entry: { ...entry, productKey: "k1" } }),
      STOREFRONT,
      DEPS,
    );
    await serveStorageRequest(
      request("history-add", { entry: { ...entry, productKey: "k2" } }),
      STOREFRONT,
      DEPS,
    );

    const response = await serveStorageRequest(
      request("history-of-product", { productKey: "k1" }),
      STOREFRONT,
      DEPS,
    );

    expect(response).toMatchObject({ ok: true });
    expect((response as { value: unknown[] }).value).toHaveLength(1);
  });

  it("returns nothing for a key the page invented", async () => {
    await expect(
      serveStorageRequest(
        request("history-of-product", { productKey: "not a product" }),
        STOREFRONT,
        DEPS,
      ),
    ).resolves.toEqual({ ok: true, value: [] });
  });

  it("refuses the question entirely from a sender that is not ours", async () => {
    await expect(
      serveStorageRequest(
        request("history-of-product", { productKey: "k1" }),
        { tab: { id: 1 }, url: "https://evil.example/" },
        DEPS,
      ),
    ).resolves.toEqual({ ok: false });
  });
});

describe("the watchlist over the message port", () => {
  const READING = {
    at: Date.parse("2026-03-01T12:00:00Z"),
    band: "mostly-clean" as const,
    probability: 0.2,
    claimedRating: 4.6,
    adjustedRating: 4.4,
    totalReviewCount: 400,
    features: null,
  };

  const LISTING = {
    productKey: "key-1",
    site: "amazon",
    title: "a stovetop kettle",
    thumbnailUrl: null,
    reading: READING,
  };

  beforeEach(async () => {
    await deleteAllWatchlist();
  });

  it("saves a listing the reader asked to watch", async () => {
    const response = await serveStorageRequest(
      request("watch-add", { listing: LISTING }),
      STOREFRONT,
      DEPS,
    );

    expect(response).toMatchObject({ ok: true, value: { watching: true } });
    expect((await listWatchlist()).map((watched) => watched.title)).toEqual(["a stovetop kettle"]);
  });

  it("saves it whether or not history is on, because watching was asked for", async () => {
    await setHistoryEnabled(false);

    await serveStorageRequest(request("watch-add", { listing: LISTING }), STOREFRONT, DEPS);

    await expect(listWatchlist()).resolves.toHaveLength(1);
  });

  it("lets go of one the reader is done with", async () => {
    await serveStorageRequest(request("watch-add", { listing: LISTING }), STOREFRONT, DEPS);

    const response = await serveStorageRequest(
      request("watch-remove", { productKey: "key-1" }),
      STOREFRONT,
      DEPS,
    );

    expect(response).toEqual({ ok: true, value: { watching: false, entry: null, changes: [] } });
    await expect(listWatchlist()).resolves.toEqual([]);
  });

  it("answers a check of a watched listing with what has moved", async () => {
    await serveStorageRequest(request("watch-add", { listing: LISTING }), STOREFRONT, DEPS);

    const response = await serveStorageRequest(
      request("watch-check", {
        productKey: "key-1",
        reading: { ...READING, band: "doubtful" },
      }),
      STOREFRONT,
      DEPS,
    );

    expect(response).toMatchObject({
      ok: true,
      value: { watching: true, changes: [{ kind: "band", from: "mostly-clean", to: "doubtful" }] },
    });
  });

  it("answers a check of a listing nobody watches with nothing", async () => {
    const response = await serveStorageRequest(
      request("watch-check", { productKey: "key-1", reading: READING }),
      STOREFRONT,
      DEPS,
    );

    expect(response).toEqual({ ok: true, value: { watching: false, entry: null, changes: [] } });
  });

  it("refuses a page that is not one of ours", async () => {
    const response = await serveStorageRequest(
      request("watch-add", { listing: LISTING }),
      { tab: { id: 7 }, url: "https://example.invalid/dp/B0ABCDEF12" },
      DEPS,
    );

    expect(response).toEqual({ ok: false });
    await expect(listWatchlist()).resolves.toEqual([]);
  });
});
