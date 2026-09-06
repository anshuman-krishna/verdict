import { DEFAULT_NUM_PERMUTATIONS, DEFAULT_SHINGLE_SIZE, minhashSignature, shingle } from "../score/textNearDuplication";
import type { Review } from "../extract/types";

// PRIVACY.md section 5, "opt in contribution": what the reviewer graph
// service (SPEC.md 5.6, PLAN.md week 9) needs from each review to build
// the bipartite reviewer-product graph, and nothing else. Sent: hashed
// reviewer identifier, hashed product identifier, star rating, week
// bucket of the review date, verified flag, minhash signature. Never
// sent: review text itself, product title, category, price, url, or any
// persistent client identifier: this interface is the enforcement of
// that list, not just a description of it, since only these fields exist
// to be sent in the first place.
export interface ContributionEdge {
  reviewerHash: string;
  productHash: string;
  starRating: number;
  weekBucket: number;
  verified: boolean | null;
  // bigint is not JSON serialisable, so the signature travels as decimal
  // strings, the same representation schema/minhash-coefficients.json
  // already uses for the same reason.
  minhashSignature: string[];
}

// sha256(input), hex encoded. Deliberately a separate implementation from
// reputation/lookup.ts's sha256Hex rather than a shared import, so this
// file does not need to know the lookup protocol's module exists at all;
// the two do, however, need to be called with the same salt for the
// reviewer hash specifically (reputation/salt.ts's REPUTATION_SALT, see
// its own comment) so a community this produces can ever be looked up
// again. The product hash has no such constraint: nothing outside this
// pipeline ever looks one up, so any salt works for it, and reusing the
// same one the caller already passes in is simpler than inventing a
// second constant with no purpose.
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;

// PRIVACY.md: "week bucket of the review date", not the date itself.
// Floor division against the epoch, so this needs no calendar library and
// two reviews on the same real week always land in the same bucket
// regardless of which day of that week they fall on. Returns null for a
// date this extension cannot parse, which buildContributionEdge treats
// the same as a missing date: not enough to build an edge from.
export function weekBucket(dateIso: string): number | null {
  const parsed = Date.parse(dateIso);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.floor(parsed / MS_PER_DAY / DAYS_PER_WEEK);
}

// a review missing a reviewer id or a date cannot be placed as an edge at
// all (there is no node to hang it off, or no week bucket to put it in),
// so this returns null for those rather than a degraded edge: an edge
// with an invented value would be worse than no edge, not just weaker.
// A review with no text still becomes an edge, with an empty signature:
// the graph signal here is co-review structure and rating, not text.
export async function buildContributionEdge(
  review: Review,
  productId: string,
  salt: string,
): Promise<ContributionEdge | null> {
  if (review.reviewerId === null || review.date === null || review.rating === null) {
    return null;
  }
  const bucket = weekBucket(review.date);
  if (bucket === null) {
    return null;
  }
  const [reviewerHash, productHash] = await Promise.all([
    sha256Hex(`${review.reviewerId}${salt}`),
    sha256Hex(`${productId}${salt}`),
  ]);
  const signature =
    review.text !== null && review.text.length > 0
      ? minhashSignature(shingle(review.text, DEFAULT_SHINGLE_SIZE), DEFAULT_NUM_PERMUTATIONS)
      : [];
  return {
    reviewerHash,
    productHash,
    starRating: review.rating,
    weekBucket: bucket,
    verified: review.verified,
    minhashSignature: signature.map(String),
  };
}
