import type { Review } from "./types";

// refetches must not read as duplication
export function reviewKey(review: Review): string {
  if (review.reviewerId !== null && review.date !== null) {
    return `id:${review.reviewerId}:${review.date}`;
  }
  return `body:${review.rating}:${review.date}:${review.verified}:${review.text}`;
}

export function mergeReviews(existing: readonly Review[], fetched: readonly Review[]): Review[] {
  const seen = new Set(existing.map(reviewKey));
  const merged = [...existing];
  for (const review of fetched) {
    const key = reviewKey(review);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(review);
  }
  return merged;
}
