import { getCachedReviews, setCachedReviews } from "../storage/reviewsCache";
import type { ProductSnapshot, Review } from "./types";

const DEFAULT_MAX_PAGES = 5;
const MIN_SPACING_MS = 800;
const JITTER_MS = 400;

export interface FetchReviewPagesOptions {
  productId: string;
  site: string;
  product: ProductSnapshot;
  fetchPage: (pageNumber: number) => Promise<Review[]>;
  maxPages?: number;
  delay?: (ms: number) => Promise<void>;
  random?: () => number;
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
  }

  await setCachedReviews(options.productId, options.site, reviews, options.product);
  return reviews;
}
