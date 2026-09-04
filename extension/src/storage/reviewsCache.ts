import type { ProductSnapshot, Review } from "../extract/types";
import { openDatabase, put, requestToPromise, STORE_NAMES, type WriteResult } from "./database";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedReviews {
  reviews: Review[];
  product: ProductSnapshot;
  cachedAt: number;
}

interface CacheRecord extends CachedReviews {
  key: string;
}

export async function cacheKey(productId: string, site: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${site}:${productId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function getCachedReviews(
  productId: string,
  site: string,
): Promise<CachedReviews | null> {
  const key = await cacheKey(productId, site);
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.reviewsCache, "readonly").objectStore(
    STORE_NAMES.reviewsCache,
  );
  const record = await requestToPromise<CacheRecord | undefined>(store.get(key));
  if (!record) {
    return null;
  }
  if (Date.now() - record.cachedAt > TTL_MS) {
    await deleteCachedReviews(productId, site);
    return null;
  }
  const { key: _key, ...cached } = record;
  return cached;
}

export async function setCachedReviews(
  productId: string,
  site: string,
  reviews: Review[],
  product: ProductSnapshot,
): Promise<WriteResult> {
  const key = await cacheKey(productId, site);
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.reviewsCache, "readwrite").objectStore(
    STORE_NAMES.reviewsCache,
  );
  const record: CacheRecord = { key, reviews, product, cachedAt: Date.now() };
  return put(store, record);
}

export async function deleteCachedReviews(productId: string, site: string): Promise<void> {
  const key = await cacheKey(productId, site);
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.reviewsCache, "readwrite").objectStore(
    STORE_NAMES.reviewsCache,
  );
  await requestToPromise(store.delete(key));
}
