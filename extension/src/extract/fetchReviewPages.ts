import { getCachedReviews, setCachedReviews } from "../storage/reviewsCache";
import type { ProductSnapshot, Review } from "./types";

export const DEFAULT_MAX_PAGES = 5;
const MIN_SPACING_MS = 800;
const JITTER_MS = 400;

// SPEC.md section 13: "verdict never shows a spinner longer than 400 ms
// without showing partial results underneath". this run is spaced at least
// 800ms per page, so it is always over that line, and the caller cannot
// show anything underneath a spinner it is given no visibility into.
export interface FetchProgress {
  pagesFetched: number;
  maxPages: number;
  // reviews read by this run only, before merging with what the product
  // page already carried, since dedupe against those happens in the
  // caller and a running total that guessed at it would be wrong.
  reviewCount: number;
}

export interface FetchReviewPagesOptions {
  productId: string;
  site: string;
  product: ProductSnapshot;
  fetchPage: (pageNumber: number) => Promise<Review[]>;
  maxPages?: number;
  delay?: (ms: number) => Promise<void>;
  random?: () => number;
  onProgress?: (progress: FetchProgress) => void;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// fetches up to maxPages of reviews in the user's own session, spaced at
// least 800ms apart with jitter, and caches the combined result. only ever
// runs when a caller explicitly invokes it: nothing here fetches on import
// or on page load, per SPEC.md section 9.
export async function fetchReviewPages(options: FetchReviewPagesOptions): Promise<Review[]> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const delay = options.delay ?? defaultDelay;
  const random = options.random ?? Math.random;

  const cached = await getCachedReviews(options.productId, options.site);
  if (cached) {
    return cached.reviews;
  }

  const reviews: Review[] = [];
  for (let page = 1; page <= maxPages; page++) {
    if (page > 1) {
      await delay(MIN_SPACING_MS + random() * JITTER_MS);
    }
    const pageReviews = await options.fetchPage(page);
    reviews.push(...pageReviews);
    options.onProgress?.({ pagesFetched: page, maxPages, reviewCount: reviews.length });
  }

  await setCachedReviews(options.productId, options.site, reviews, options.product);
  return reviews;
}
