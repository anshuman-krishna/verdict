import type { Review } from "../extract/types";
import { EMBEDDING_DIMENSIONS, embedTermCounts, hashTerms } from "../score/textEmbedding";
import {
  DEFAULT_NUM_PERMUTATIONS,
  DEFAULT_SHINGLE_SIZE,
  minhashSignature,
  shingle,
} from "../score/textNearDuplication";
import { openDatabase, put, requestToPromise, STORE_NAMES, type WriteResult } from "./database";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;


interface StoredReview {
  rating: number | null;
  date: string | null;
  verified: boolean | null;
  reviewerId: string | null;
  textSignature: string[] | null;
  textTermCounts: number[] | null;
}

interface CacheRecord {
  key: string;
  reviews: StoredReview[];
  cachedAt: number;
  pagesFetched: number;
  shingleSize: number;
  numPermutations: number;
  embeddingDimensions: number;
}

export interface CachedReviews {
  reviews: Review[];
  signatures: WeakMap<Review, bigint[]>;
  embeddings: WeakMap<Review, number[]>;
  cachedAt: number;
  pagesFetched: number;
}

export function isExpired(cachedAt: number, now: number): boolean {
  // a clock that moved backwards must not extend retention
  return now - cachedAt > TTL_MS || cachedAt > now + TTL_MS;
}

export async function cacheKey(productId: string, site: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${site}:${productId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toStored(review: Review): StoredReview {
  const text = review.text;
  return {
    rating: review.rating,
    date: review.date,
    verified: review.verified,
    reviewerId: review.reviewerId,
    textSignature:
      text === null || text.length === 0
        ? null
        : minhashSignature(shingle(text, DEFAULT_SHINGLE_SIZE), DEFAULT_NUM_PERMUTATIONS).map(
            (value) => value.toString(),
          ),
    textTermCounts: text === null || text.length === 0 ? null : hashTerms(text),
  };
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
  if (isExpired(record.cachedAt, Date.now())) {
    await deleteCachedReviews(productId, site);
    return null;
  }
  if (
    record.shingleSize !== DEFAULT_SHINGLE_SIZE ||
    record.numPermutations !== DEFAULT_NUM_PERMUTATIONS ||
    record.embeddingDimensions !== EMBEDDING_DIMENSIONS
  ) {
    await deleteCachedReviews(productId, site);
    return null;
  }

  const reviews: Review[] = [];
  const signatures = new WeakMap<Review, bigint[]>();
  const embeddings = new WeakMap<Review, number[]>();
  for (const stored of record.reviews) {
    const review: Review = {
      rating: stored.rating,
      text: null,
      date: stored.date,
      verified: stored.verified,
      reviewerId: stored.reviewerId,
    };
    reviews.push(review);
    if (Array.isArray(stored.textSignature)) {
      signatures.set(review, stored.textSignature.map((value) => BigInt(value)));
    }
    const embedding = Array.isArray(stored.textTermCounts)
      ? embedTermCounts(stored.textTermCounts)
      : null;
    if (embedding !== null) {
      embeddings.set(review, embedding);
    }
  }
  return {
    reviews,
    signatures,
    embeddings,
    cachedAt: record.cachedAt,
    pagesFetched: record.pagesFetched ?? 0,
  };
}

export async function setCachedReviews(
  productId: string,
  site: string,
  reviews: readonly Review[],
  pagesFetched = 0,
): Promise<WriteResult> {
  const key = await cacheKey(productId, site);
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.reviewsCache, "readwrite").objectStore(
    STORE_NAMES.reviewsCache,
  );
  const record: CacheRecord = {
    key,
    reviews: reviews.map(toStored),
    cachedAt: Date.now(),
    pagesFetched,
    shingleSize: DEFAULT_SHINGLE_SIZE,
    numPermutations: DEFAULT_NUM_PERMUTATIONS,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
  };
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

// nothing else expires a product the user never opened again
export async function pruneExpiredReviewsCache(now: number = Date.now()): Promise<number> {
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.reviewsCache, "readwrite").objectStore(
    STORE_NAMES.reviewsCache,
  );
  const records = await requestToPromise<CacheRecord[]>(store.getAll());
  let pruned = 0;
  for (const record of records) {
    if (isExpired(record.cachedAt, now)) {
      await requestToPromise(store.delete(record.key));
      pruned++;
    }
  }
  return pruned;
}
