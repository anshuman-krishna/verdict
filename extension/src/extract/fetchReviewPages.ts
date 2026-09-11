import type { CachedReviews } from "../storage/reviewsCodec";
import { reviewKey } from "./reviewIdentity";
import type { Review } from "./types";

export const DEFAULT_MAX_PAGES = 5;
const MIN_SPACING_MS = 800;
const JITTER_MS = 400;

export interface FetchProgress {
  pagesFetched: number;
  maxPages: number;
  reviewCount: number;
}

export type FetchStop = "exhausted" | "repeated" | "failed" | "complete";

export interface FetchedReviews {
  reviews: Review[];
  signatures: WeakMap<Review, bigint[]>;
  embeddings: WeakMap<Review, number[]>;
  pagesFetched: number;
  stoppedBecause: FetchStop;
}

export interface ReviewsCachePort {
  read: (productId: string, site: string) => Promise<CachedReviews | null>;
  write: (
    productId: string,
    site: string,
    reviews: readonly Review[],
    pagesFetched: number,
  ) => Promise<unknown>;
}

// the fallback stores nothing, because nothing here may reach a storefront's own indexeddb
export const NO_REVIEWS_CACHE: ReviewsCachePort = {
  read: async () => null,
  write: async () => undefined,
};

export interface FetchReviewPagesOptions {
  productId: string;
  site: string;
  fetchPage: (pageNumber: number) => Promise<Review[]>;
  maxPages?: number;
  delay?: (ms: number) => Promise<void>;
  random?: () => number;
  onProgress?: (progress: FetchProgress) => void;
  // required, so nothing here can reach for the storefront's own indexeddb
  cache: ReviewsCachePort;
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

  const cached = await options.cache.read(options.productId, options.site);
  // a shallower cached run must not answer a deeper request
  if (cached && cached.pagesFetched >= maxPages) {
    return {
      reviews: cached.reviews,
      signatures: cached.signatures,
      embeddings: cached.embeddings,
      pagesFetched: cached.pagesFetched,
      stoppedBecause: "complete",
    };
  }

  const reviews: Review[] = [];
  const seen = new Set<string>();
  let pagesFetched = 0;
  let stoppedBecause: FetchStop = "complete";

  for (let page = 1; page <= maxPages; page++) {
    if (page > 1) {
      await delay(MIN_SPACING_MS + random() * JITTER_MS);
    }
    let pageReviews: Review[];
    try {
      pageReviews = await options.fetchPage(page);
    } catch {
      // keep the pages that did arrive rather than losing the run
      stoppedBecause = "failed";
      break;
    }
    pagesFetched = page;
    if (pageReviews.length === 0) {
      stoppedBecause = "exhausted";
      break;
    }
    let added = 0;
    for (const review of pageReviews) {
      const key = reviewKey(review);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      reviews.push(review);
      added++;
    }
    options.onProgress?.({ pagesFetched: page, maxPages, reviewCount: reviews.length });
    // amazon caps review pages at 10, deeper paging silently repeats the last page
    if (added === 0) {
      stoppedBecause = "repeated";
      break;
    }
  }

  if (reviews.length > 0) {
    await options.cache.write(options.productId, options.site, reviews, pagesFetched);
  }
  return {
    reviews,
    signatures: new WeakMap(),
    embeddings: new WeakMap(),
    pagesFetched,
    stoppedBecause,
  };
}
