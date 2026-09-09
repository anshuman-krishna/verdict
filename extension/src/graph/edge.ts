import { DEFAULT_NUM_PERMUTATIONS, DEFAULT_SHINGLE_SIZE, minhashSignature, shingle } from "../score/textNearDuplication";
import type { Review } from "../extract/types";

export interface ContributionEdge {
  reviewerHash: string;
  productHash: string;
  starRating: number;
  weekBucket: number;
  verified: boolean | null;
  minhashSignature: string[];
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;

export function weekBucket(dateIso: string): number | null {
  const parsed = Date.parse(dateIso);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.floor(parsed / MS_PER_DAY / DAYS_PER_WEEK);
}

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
