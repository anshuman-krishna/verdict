import { getCachedReviews, setCachedReviews } from "../storage/reviewsCache";
import type { Review } from "./types";

export const DEFAULT_MAX_PAGES = 5;
const MIN_SPACING_MS = 800;
const JITTER_MS = 400;

export interface FetchProgress {
  pagesFetched: number;
  maxPages: number;
  reviewCount: number;
}

export interface FetchedReviews {
  reviews: Review[];
  signatures: WeakMap<Review, bigint[]>;
  embeddings: WeakMap<Review, number[]>;
}

export interface FetchReviewPagesOptions {
  productId: string;
  site: string;
  fetchPage: (pageNumber: number) => Promise<Review[]>;
  maxPages?: number;
  delay?: (ms: number) => Promise<void>;
  random?: () => number;
  onProgress?: (progress: FetchProgress) => void;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchReviewPages(
  options: FetchReviewPagesOptions,
): Promise<FetchedReviews> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const delay = options.delay ?? defaultDelay;
  const random = options.random ?? Math.random;

  const cached = await getCachedReviews(options.productId, options.site);
  if (cached) {
    return {
      reviews: cached.reviews,
      signatures: cached.signatures,
      embeddings: cached.embeddings,
    };
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

  await setCachedReviews(options.productId, options.site, reviews);
  return { reviews, signatures: new WeakMap(), embeddings: new WeakMap() };
}
