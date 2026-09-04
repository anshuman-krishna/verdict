import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { ProductSnapshot, Review } from "../extract/types";
import { openDatabase, put, STORE_NAMES } from "./database";
import { cacheKey, deleteCachedReviews, getCachedReviews, setCachedReviews } from "./reviewsCache";

const review: Review = {
  rating: 5,
  text: "great",
  date: "2026-01-01",
  verified: true,
  reviewerId: "r-1",
};

const product: ProductSnapshot = {
  title: "a product",
  category: "kitchen",
  claimedRating: 4.6,
  reviewCount: 100,
  site: "amazon",
  locale: "com",
  url: "https://www.amazon.com/dp/B000EXAMPLE",
  thumbnailUrl: null,
};

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function writeStaleRecord(productId: string, site: string, cachedAt: number) {
  const key = await cacheKey(productId, site);
  const db = await openDatabase();
  const store = db
    .transaction(STORE_NAMES.reviewsCache, "readwrite")
    .objectStore(STORE_NAMES.reviewsCache);
  await put(store, { key, reviews: [review], product, cachedAt });
}

describe("reviews cache", () => {
  it("returns null before anything is cached", async () => {
    await expect(getCachedReviews("unset-product", "amazon")).resolves.toBeNull();
  });

  it("round trips a write through a read", async () => {
    await setCachedReviews("p-1", "amazon", [review], product);
    const cached = await getCachedReviews("p-1", "amazon");
    expect(cached).toEqual({ reviews: [review], product, cachedAt: expect.any(Number) });
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
    await setCachedReviews("p-6", "amazon", [review], product);
    await deleteCachedReviews("p-6", "amazon");
    await expect(getCachedReviews("p-6", "amazon")).resolves.toBeNull();
  });
});
