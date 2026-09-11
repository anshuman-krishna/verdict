import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { Review } from "../extract/types";
import { EMBEDDING_DIMENSIONS, embedText } from "../score/textEmbedding";
import { DEFAULT_NUM_PERMUTATIONS, DEFAULT_SHINGLE_SIZE } from "../score/textNearDuplication";
import { openDatabase, put, STORE_NAMES } from "./database";
import {
  cacheKey,
  clearReviewsCache,
  countCachedProducts,
  deleteCachedReviews,
  getCachedReviews,
  pruneExpiredReviewsCache,
  setCachedReviews,
} from "./reviewsCache";

const review: Review = {
  rating: 5,
  text: "a review with enough words in it to shingle over properly",
  date: "2026-01-01",
  verified: true,
  reviewerId: "r-1",
};

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function writeStaleRecord(productId: string, site: string, cachedAt: number) {
  const key = await cacheKey(productId, site);
  const db = await openDatabase();
  const store = db
    .transaction(STORE_NAMES.reviewsCache, "readwrite")
    .objectStore(STORE_NAMES.reviewsCache);
  await put(store, {
    key,
    reviews: [
      {
        rating: 5,
        date: "2026-01-01",
        verified: true,
        reviewerId: "r-1",
        textSignature: null,
        textTermCounts: null,
      },
    ],
    cachedAt,
    shingleSize: DEFAULT_SHINGLE_SIZE,
    numPermutations: DEFAULT_NUM_PERMUTATIONS,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
  });
}

async function writeLegacyRecord(productId: string, site: string) {
  const key = await cacheKey(productId, site);
  const db = await openDatabase();
  const store = db
    .transaction(STORE_NAMES.reviewsCache, "readwrite")
    .objectStore(STORE_NAMES.reviewsCache);
  await put(store, {
    key,
    reviews: [{ rating: 5, text: "the old build kept this", date: "2026-01-01" }],
    product: { title: "a product", url: "https://www.amazon.com/dp/B0ABCDEF12" },
    cachedAt: Date.now(),
  });
}

describe("reviews cache", () => {
  it("returns null before anything is cached", async () => {
    await expect(getCachedReviews("unset-product", "amazon")).resolves.toBeNull();
  });

  it("round trips every field except the text", async () => {
    await setCachedReviews("p-1", "amazon", [review]);
    const cached = await getCachedReviews("p-1", "amazon");
    expect(cached?.reviews).toEqual([{ ...review, text: null }]);
    expect(cached?.cachedAt).toEqual(expect.any(Number));
  });

  it("keys the same product and site to the same hash", async () => {
    const first = await cacheKey("p-2", "amazon");
    const second = await cacheKey("p-2", "amazon");
    expect(first).toBe(second);
  });

  it("keys different sites for the same product id differently", async () => {
    const amazonKey = await cacheKey("p-3", "amazon");
    const otherKey = await cacheKey("p-3", "other-site");
    expect(amazonKey).not.toBe(otherKey);
  });

  it("expires an entry older than the seven day ttl", async () => {
    await writeStaleRecord("p-4", "amazon", Date.now() - TTL_MS - 1);
    await expect(getCachedReviews("p-4", "amazon")).resolves.toBeNull();
  });

  it("does not expire an entry just under the ttl", async () => {
    await writeStaleRecord("p-5", "amazon", Date.now() - TTL_MS + 1000);
    await expect(getCachedReviews("p-5", "amazon")).resolves.not.toBeNull();
  });

  it("deleteCachedReviews removes the entry", async () => {
    await setCachedReviews("p-6", "amazon", [review]);
    await deleteCachedReviews("p-6", "amazon");
    await expect(getCachedReviews("p-6", "amazon")).resolves.toBeNull();
  });
});

describe("what the cache is allowed to persist", () => {
  async function storedRecord(productId: string): Promise<Record<string, unknown>> {
    const key = await cacheKey(productId, "amazon");
    const db = await openDatabase();
    const store = db
      .transaction(STORE_NAMES.reviewsCache, "readonly")
      .objectStore(STORE_NAMES.reviewsCache);
    return await new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  it("writes no review text to the database at all", async () => {
    await setCachedReviews("p-text", "amazon", [review]);
    const serialised = JSON.stringify(await storedRecord("p-text"), (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(serialised).not.toContain("shingle over properly");
    expect(serialised).not.toContain(review.text as string);
  });

  it("writes no product title or url either, only the hashed key", async () => {
    await setCachedReviews("p-product", "amazon", [review]);
    const record = await storedRecord("p-product");
    expect(Object.keys(record).sort()).toEqual([
      "cachedAt",
      "embeddingDimensions",
      "key",
      "numPermutations",
      "pagesFetched",
      "reviews",
      "shingleSize",
    ]);
  });

  it("keeps an embedding that scores the same as the text it replaced", async () => {
    await setCachedReviews("p-embedding", "amazon", [review]);
    const cached = await getCachedReviews("p-embedding", "amazon");
    const embedding = cached?.embeddings.get(cached.reviews[0] as Review);
    expect(embedding).toEqual(embedText(review.text as string));
  });

  it("keeps a full length signature for a review that had text", async () => {
    await setCachedReviews("p-sig", "amazon", [review]);
    const cached = await getCachedReviews("p-sig", "amazon");
    const signature = cached?.signatures.get(cached.reviews[0] as Review);
    expect(signature).toHaveLength(DEFAULT_NUM_PERMUTATIONS);
    expect(typeof signature?.[0]).toBe("bigint");
  });

  it("keeps no signature for a review that had no text", async () => {
    const textless: Review = { ...review, text: null };
    await setCachedReviews("p-nosig", "amazon", [textless]);
    const cached = await getCachedReviews("p-nosig", "amazon");
    expect(cached?.signatures.get(cached.reviews[0] as Review)).toBeUndefined();
  });

  it("keeps no signature for a review whose text was empty", async () => {
    await setCachedReviews("p-emptysig", "amazon", [{ ...review, text: "" }]);
    const cached = await getCachedReviews("p-emptysig", "amazon");
    expect(cached?.signatures.get(cached.reviews[0] as Review)).toBeUndefined();
  });

  it("discards a record whose signature parameters are not this build's", async () => {
    const key = await cacheKey("p-params", "amazon");
    const db = await openDatabase();
    const store = db
      .transaction(STORE_NAMES.reviewsCache, "readwrite")
      .objectStore(STORE_NAMES.reviewsCache);
    await put(store, {
      key,
      reviews: [
        { rating: 5, date: "2026-01-01", verified: true, reviewerId: "r-1", textSignature: null },
      ],
      cachedAt: Date.now(),
      shingleSize: DEFAULT_SHINGLE_SIZE + 1,
      numPermutations: DEFAULT_NUM_PERMUTATIONS,
    });
    await expect(getCachedReviews("p-params", "amazon")).resolves.toBeNull();
  });

  it("discards a record from a build that did not record its parameters", async () => {
    await writeLegacyRecord("p-legacy", "amazon");
    await expect(getCachedReviews("p-legacy", "amazon")).resolves.toBeNull();
  });

  it("discards a record written before the drift embedding was stored", async () => {
    const key = await cacheKey("p-no-embedding", "amazon");
    const db = await openDatabase();
    const store = db
      .transaction(STORE_NAMES.reviewsCache, "readwrite")
      .objectStore(STORE_NAMES.reviewsCache);
    await put(store, {
      key,
      reviews: [],
      cachedAt: Date.now(),
      shingleSize: DEFAULT_SHINGLE_SIZE,
      numPermutations: DEFAULT_NUM_PERMUTATIONS,
    });
    await expect(getCachedReviews("p-no-embedding", "amazon")).resolves.toBeNull();
  });

  it("gives the same text the same signature across two writes", async () => {
    await setCachedReviews("p-stable-a", "amazon", [review]);
    await setCachedReviews("p-stable-b", "amazon", [{ ...review, reviewerId: "r-2" }]);
    const a = await getCachedReviews("p-stable-a", "amazon");
    const b = await getCachedReviews("p-stable-b", "amazon");
    expect(a?.signatures.get(a.reviews[0] as Review)).toEqual(
      b?.signatures.get(b.reviews[0] as Review),
    );
  });
});

describe("retention, which PRIVACY.md puts at seven days", () => {
  async function rawRecord(productId: string): Promise<unknown> {
    const key = await cacheKey(productId, "amazon");
    const db = await openDatabase();
    const store = db
      .transaction(STORE_NAMES.reviewsCache, "readonly")
      .objectStore(STORE_NAMES.reviewsCache);
    return await new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  it("deletes a stale entry the user never opened again", async () => {
    await writeStaleRecord("p-sweep-stale", "amazon", Date.now() - TTL_MS - 1);
    expect(await rawRecord("p-sweep-stale")).toBeDefined();

    await pruneExpiredReviewsCache();

    expect(await rawRecord("p-sweep-stale")).toBeUndefined();
  });

  it("leaves an entry still inside the ttl alone", async () => {
    await setCachedReviews("p-sweep-fresh", "amazon", [review]);
    await pruneExpiredReviewsCache();
    await expect(getCachedReviews("p-sweep-fresh", "amazon")).resolves.not.toBeNull();
  });

  it("reports how many it removed", async () => {
    await writeStaleRecord("p-sweep-a", "amazon", Date.now() - TTL_MS - 1);
    await writeStaleRecord("p-sweep-b", "amazon", Date.now() - TTL_MS - 1);
    expect(await pruneExpiredReviewsCache()).toBeGreaterThanOrEqual(2);
  });

  it("does not keep an entry forever because the clock moved backwards", async () => {
    await writeStaleRecord("p-sweep-future", "amazon", Date.now() + TTL_MS * 2);
    await pruneExpiredReviewsCache();
    expect(await rawRecord("p-sweep-future")).toBeUndefined();
  });
});

describe("what the options page reports about the cache", () => {
  it("counts nothing on an empty cache, with no oldest entry", async () => {
    await clearReviewsCache();
    await expect(countCachedProducts()).resolves.toEqual({ count: 0, oldestCachedAt: null });
  });

  it("counts one record per listing, whatever the site", async () => {
    await clearReviewsCache();
    await setCachedReviews("p-a", "amazon", [review]);
    await setCachedReviews("p-a", "other-site", [review]);

    await expect(countCachedProducts()).resolves.toMatchObject({ count: 2 });
  });

  it("reports the oldest entry, which is the one closest to expiring", async () => {
    await clearReviewsCache();
    await writeStaleRecord("p-old", "amazon", 1_000_000);
    await setCachedReviews("p-new", "amazon", [review]);

    await expect(countCachedProducts()).resolves.toMatchObject({ oldestCachedAt: 1_000_000 });
  });

  it("clears every listing at once, expired or not", async () => {
    await setCachedReviews("p-1", "amazon", [review]);
    await setCachedReviews("p-2", "amazon", [review]);

    await clearReviewsCache();

    expect((await countCachedProducts()).count).toBe(0);
  });
});
