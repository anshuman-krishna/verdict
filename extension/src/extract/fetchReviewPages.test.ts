import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { ProductSnapshot, Review } from "./types";
import { fetchReviewPages, type FetchProgress } from "./fetchReviewPages";

const product: ProductSnapshot = {
  title: "a product",
  category: "kitchen",
  claimedRating: 4.6,
  reviewCount: 100,
  site: "amazon",
  locale: "com",
  url: "https://www.amazon.com/dp/B000EXAMPLE",
  thumbnailUrl: null,
};

function review(text: string): Review {
  return { rating: 5, text, date: "2026-01-01", verified: true, reviewerId: "r-1" };
}

describe("fetchReviewPages", () => {
  it("does not call fetchPage until explicitly invoked", async () => {
    const fetchPage = vi.fn(async (page: number) => [review(`page ${page}`)]);
    // importing the module and building the options object triggers nothing
    expect(fetchPage).not.toHaveBeenCalled();
    await fetchReviewPages({
      productId: "p-lazy",
      site: "amazon",
      product,
      fetchPage,
      maxPages: 1,
      delay: async () => {},
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  // SPEC.md section 13: a caller showing a busy state needs partial
  // results to put underneath it, and this run is spaced at least 800ms
  // per page, so it is always over the 400ms line.
  it("reports progress after every page, with a cumulative review count", async () => {
    const progress: FetchProgress[] = [];
    await fetchReviewPages({
      productId: "p-progress",
      site: "amazon",
      product,
      fetchPage: async (page) => [review(`page ${page} a`), review(`page ${page} b`)],
      maxPages: 3,
      delay: async () => {},
      onProgress: (update) => progress.push(update),
    });
    expect(progress).toEqual([
      { pagesFetched: 1, maxPages: 3, reviewCount: 2 },
      { pagesFetched: 2, maxPages: 3, reviewCount: 4 },
      { pagesFetched: 3, maxPages: 3, reviewCount: 6 },
    ]);
  });

  it("reports no progress on a cache hit, since nothing slow happened", async () => {
    const fetchPage = vi.fn(async (page: number) => [review(`page ${page}`)]);
    const options = {
      productId: "p-cached-progress",
      site: "amazon",
      product,
      fetchPage,
      maxPages: 1,
      delay: async () => {},
    };
    await fetchReviewPages(options);
    const progress: FetchProgress[] = [];
    await fetchReviewPages({ ...options, onProgress: (update) => progress.push(update) });
    expect(progress).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("fetches up to the page cap and combines the results", async () => {
    const fetchPage = vi.fn(async (page: number) => [review(`page ${page}`)]);
    const reviews = await fetchReviewPages({
      productId: "p-cap",
      site: "amazon",
      product,
      fetchPage,
      delay: async () => {},
    });
    expect(fetchPage).toHaveBeenCalledTimes(5);
    expect(reviews.map((r) => r.text)).toEqual([
      "page 1",
      "page 2",
      "page 3",
      "page 4",
      "page 5",
    ]);
  });

  it("respects a lower explicit page cap", async () => {
    const fetchPage = vi.fn(async (page: number) => [review(`page ${page}`)]);
    await fetchReviewPages({
      productId: "p-cap-2",
      site: "amazon",
      product,
      fetchPage,
      maxPages: 2,
      delay: async () => {},
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("spaces every fetch after the first by at least 800ms plus jitter", async () => {
    const delays: number[] = [];
    const fetchPage = vi.fn(async (page: number) => [review(`page ${page}`)]);
    await fetchReviewPages({
      productId: "p-spacing",
      site: "amazon",
      product,
      fetchPage,
      maxPages: 3,
      delay: async (ms) => {
        delays.push(ms);
      },
      random: () => 0.5,
    });
    expect(delays).toHaveLength(2);
    for (const ms of delays) {
      expect(ms).toBeGreaterThanOrEqual(800);
      expect(ms).toBeLessThanOrEqual(1200);
    }
  });

  it("does not delay before the first page", async () => {
    const delays: number[] = [];
    const fetchPage = vi.fn(async () => [review("only page")]);
    await fetchReviewPages({
      productId: "p-first",
      site: "amazon",
      product,
      fetchPage,
      maxPages: 1,
      delay: async (ms) => {
        delays.push(ms);
      },
    });
    expect(delays).toHaveLength(0);
  });

  it("hits the cache on a repeat run and does not fetch again", async () => {
    const fetchPage = vi.fn(async (page: number) => [review(`page ${page}`)]);
    const first = await fetchReviewPages({
      productId: "p-cache",
      site: "amazon",
      product,
      fetchPage,
      maxPages: 2,
      delay: async () => {},
    });
    const callsAfterFirstRun = fetchPage.mock.calls.length;

    const second = await fetchReviewPages({
      productId: "p-cache",
      site: "amazon",
      product,
      fetchPage,
      maxPages: 2,
      delay: async () => {},
    });

    expect(fetchPage.mock.calls.length).toBe(callsAfterFirstRun);
    expect(second).toEqual(first);
  });
});
