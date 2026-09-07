import type { Review } from "../extract/types";
import {
  DEFAULT_NUM_PERMUTATIONS,
  DEFAULT_SHINGLE_SIZE,
  minhashSignature,
  shingle,
} from "../score/textNearDuplication";
import { openDatabase, put, requestToPromise, STORE_NAMES, type WriteResult } from "./database";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

// PRIVACY.md section 2 is unambiguous about this store: "review text is
// never persisted. It is parsed, hashed for the duplication signal,
// embedded for the drift signal, and dropped. The MinHash signature and
// the embedding centroid are kept, and neither can reconstruct the text."
// SPEC.md section 9 still wants the fetched pages cached for 7 days, so
// what is written here is every field except the text, plus the signature
// that stands in for it.
//
// The signature is not a compression of the text. It is 128 minima over
// hashed 5 character shingles, so it supports "how similar are these two
// reviews" and nothing else: there is no inverse.
//
// Keeping the numbers identical is the point. score/textNearDuplication.ts
// accepts a seeded signature in place of text, so a report built from a
// cache hit and one built from a fresh fetch produce the same duplication
// figures rather than quietly different ones.

interface StoredReview {
  rating: number | null;
  date: string | null;
  verified: boolean | null;
  reviewerId: string | null;
  // bigints as decimal strings: IndexedDB's structured clone does carry
  // BigInt, but a stored value that survives an export, a devtools
  // inspection, and a schema migration in one obvious form is worth more
  // here than saving a few bytes.
  textSignature: string[] | null;
}

interface CacheRecord {
  key: string;
  reviews: StoredReview[];
  cachedAt: number;
  // the parameters the signatures above were computed with. Without these,
  // a later change to the shingle size would produce signatures of the
  // right length and the wrong meaning, and the duplication numbers would
  // be quietly wrong rather than obviously missing. A record whose
  // parameters do not match this build is discarded, not reinterpreted.
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
