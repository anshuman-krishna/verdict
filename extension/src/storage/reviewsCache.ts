import type { Review } from "../extract/types";
import {
  DEFAULT_NUM_PERMUTATIONS,
  DEFAULT_SHINGLE_SIZE,
  minhashSignature,
  shingle,
} from "../score/textNearDuplication";
import { openDatabase, put, requestToPromise, STORE_NAMES, type WriteResult } from "./database";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

// PRIVACY.md section 2: review text is never persisted. every field except the text is, plus the
// minhash signature that stands in for it, which supports "how similar" and has no inverse.
// textNearDuplication.ts takes a seeded signature, so a cache hit scores identically to a fresh fetch

interface StoredReview {
  rating: number | null;
  date: string | null;
  verified: boolean | null;
  reviewerId: string | null;
  // decimal strings rather than bigint: worth more in an export or a migration than the bytes saved
  textSignature: string[] | null;
}

interface CacheRecord {
  key: string;
  reviews: StoredReview[];
  cachedAt: number;
  // without these, a shingle size change gives signatures of the right length and the wrong meaning
  shingleSize: number;
  numPermutations: number;
}

export interface CachedReviews {
  // every review as stored, with text null. Never the text that was
  // fetched: it does not survive this module.
  reviews: Review[];
  // keyed by the objects in `reviews` above, ready to hand to
  // score/textNearDuplication.ts as its signatureCache.
  signatures: WeakMap<Review, bigint[]>;
  cachedAt: number;
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
  if (Date.now() - record.cachedAt > TTL_MS) {
    await deleteCachedReviews(productId, site);
    return null;
  }
  // treated exactly like an expired record: a re-fetch is cheap, and a
  // report built on signatures this build cannot interpret is not.
  if (
    record.shingleSize !== DEFAULT_SHINGLE_SIZE ||
    record.numPermutations !== DEFAULT_NUM_PERMUTATIONS
  ) {
    await deleteCachedReviews(productId, site);
    return null;
  }

  const reviews: Review[] = [];
  const signatures = new WeakMap<Review, bigint[]>();
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
  }
  return { reviews, signatures, cachedAt: record.cachedAt };
}

export async function setCachedReviews(
  productId: string,
  site: string,
  reviews: readonly Review[],
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
    shingleSize: DEFAULT_SHINGLE_SIZE,
    numPermutations: DEFAULT_NUM_PERMUTATIONS,
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
