import type { Review } from "../extract/types";
import { openDatabase, put, requestToPromise, STORE_NAMES, type WriteResult } from "./database";
import {
  cacheKey,
  hydrateCacheRecord,
  isExpired,
  isThisBuilds,
  toRecord,
  toStored,
  type CachedReviews,
  type ReviewsCacheRecord,
  type StoredReview,
} from "./reviewsCodec";

export {
  cacheKey,
  hydrateCacheRecord,
  isExpired,
  toStored,
  type CachedReviews,
  type ReviewsCacheRecord,
  type StoredReview,
};

// the direct port, for the background and for tests; the content script uses the message one
export const directReviewsCache = {
  read: getCachedReviews,
  write: setCachedReviews,
};

// the record crosses to the content script as it is, so hydration stays separate
export async function readCacheRecord(
  productId: string,
  site: string,
): Promise<ReviewsCacheRecord | null> {
  const key = await cacheKey(productId, site);
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.reviewsCache, "readonly").objectStore(
    STORE_NAMES.reviewsCache,
  );
  const record = await requestToPromise<ReviewsCacheRecord | undefined>(store.get(key));
  if (!record) {
    return null;
  }
  if (isExpired(record.cachedAt, Date.now()) || !isThisBuilds(record)) {
    await deleteCachedReviews(productId, site);
    return null;
  }
  return record;
}

export async function getCachedReviews(
  productId: string,
  site: string,
): Promise<CachedReviews | null> {
  const record = await readCacheRecord(productId, site);
  return record === null ? null : hydrateCacheRecord(record);
}

export async function setCachedReviews(
  productId: string,
  site: string,
  reviews: readonly Review[],
  pagesFetched = 0,
): Promise<WriteResult> {
  return putStoredReviews(productId, site, reviews.map(toStored), pagesFetched);
}

export async function putStoredReviews(
  productId: string,
  site: string,
  reviews: readonly StoredReview[],
  pagesFetched: number,
): Promise<WriteResult> {
  const key = await cacheKey(productId, site);
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.reviewsCache, "readwrite").objectStore(
    STORE_NAMES.reviewsCache,
  );
  return put(store, toRecord(key, reviews, pagesFetched, Date.now()));
}

export async function deleteCachedReviews(productId: string, site: string): Promise<void> {
  const key = await cacheKey(productId, site);
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.reviewsCache, "readwrite").objectStore(
    STORE_NAMES.reviewsCache,
  );
  await requestToPromise(store.delete(key));
}

export interface CachedProducts {
  count: number;
  oldestCachedAt: number | null;
}

export async function countCachedProducts(): Promise<CachedProducts> {
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.reviewsCache, "readonly").objectStore(
    STORE_NAMES.reviewsCache,
  );
  const records = await requestToPromise<ReviewsCacheRecord[]>(store.getAll());
  if (records.length === 0) {
    return { count: 0, oldestCachedAt: null };
  }
  return {
    count: records.length,
    oldestCachedAt: Math.min(...records.map((record) => record.cachedAt)),
  };
}

export async function clearReviewsCache(): Promise<void> {
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.reviewsCache, "readwrite").objectStore(
    STORE_NAMES.reviewsCache,
  );
  await requestToPromise(store.clear());
}

// nothing else expires a product the user never opened again
export async function pruneExpiredReviewsCache(now: number = Date.now()): Promise<number> {
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.reviewsCache, "readwrite").objectStore(
    STORE_NAMES.reviewsCache,
  );
  const records = await requestToPromise<ReviewsCacheRecord[]>(store.getAll());
  let pruned = 0;
  for (const record of records) {
    if (isExpired(record.cachedAt, now)) {
      await requestToPromise(store.delete(record.key));
      pruned++;
    }
  }
  return pruned;
}
