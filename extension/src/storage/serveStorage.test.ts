import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RulesDocument } from "../extract/rules";
import { STORAGE_MESSAGE_TYPE, type StorageRequest } from "./messages";
import { deleteAllHistory, listHistory } from "./history";
import { countQueuedContributions, deleteContributions, listDueContributions } from "../graph/queue";
import { isOurContentScript, serveStorageRequest } from "./serveStorage";
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

  it("hands back the rules the background trusts", async () => {
    await expect(serveStorageRequest(request("rules"), STOREFRONT, DEPS)).resolves.toEqual({
      ok: true,
      value: RULES,
    });
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
    await expect(serveStorageRequest(request("rules"), STOREFRONT, failing)).resolves.toEqual({
      ok: false,
    });
  });
});

describe("settings the content script reads", () => {
  it("does not reach indexeddb from the page's side at all", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, value: RULES });
    const { readRules } = await import("./viaBackground");
    await readRules({ ...RULES, version: 99 }, send);

    expect(send).toHaveBeenCalledWith({ type: STORAGE_MESSAGE_TYPE, op: "rules" });
  });
});
