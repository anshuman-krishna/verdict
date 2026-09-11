import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { Review } from "./types";
import { fetchReviewPages, type FetchProgress } from "./fetchReviewPages";
import { directReviewsCache } from "../storage/reviewsCache";

// distinct reviewers, so paging is not mistaken for the repeated last page
function review(text: string): Review {
  return { rating: 5, text, date: "2026-01-01", verified: true, reviewerId: `r-${text}` };
}

describe("fetchReviewPages", () => {
  it("does not call fetchPage until explicitly invoked", async () => {
    const fetchPage = vi.fn(async (page: number) => [review(`page ${page}`)]);
    expect(fetchPage).not.toHaveBeenCalled();
    await fetchReviewPages({
      productId: "p-lazy",
      site: "amazon",
      cache: directReviewsCache,
      fetchPage,
      maxPages: 1,
      delay: async () => {},
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("reports progress after every page, with a cumulative review count", async () => {
    const progress: FetchProgress[] = [];
    await fetchReviewPages({
      productId: "p-progress",
      site: "amazon",
      cache: directReviewsCache,
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
      cache: directReviewsCache,
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
      cache: directReviewsCache,
      fetchPage,
      delay: async () => {},
    });
    expect(fetchPage).toHaveBeenCalledTimes(5);
    expect(reviews.reviews.map((r) => r.text)).toEqual([
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
      cache: directReviewsCache,
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
      cache: directReviewsCache,
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
      cache: directReviewsCache,
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
      cache: directReviewsCache,
      fetchPage,
      maxPages: 2,
      delay: async () => {},
    });
    const callsAfterFirstRun = fetchPage.mock.calls.length;

    const second = await fetchReviewPages({
      productId: "p-cache",
      site: "amazon",
      cache: directReviewsCache,
      fetchPage,
      maxPages: 2,
      delay: async () => {},
    });

    expect(fetchPage.mock.calls.length).toBe(callsAfterFirstRun);
    expect(second.reviews).toHaveLength(first.reviews.length);
    expect(second.reviews.map((r) => r.reviewerId)).toEqual(first.reviews.map((r) => r.reviewerId));
  });

  describe("what survives the cache", () => {
    it("returns no review text at all on a cache hit", async () => {
      const options = {
        productId: "p-notext",
        site: "amazon",
        cache: directReviewsCache,
        fetchPage: async (page: number) => [review(`page ${page} with real review text`)],
        maxPages: 2,
        delay: async () => {},
      };
      const fresh = await fetchReviewPages(options);
      expect(fresh.reviews.every((r) => r.text !== null)).toBe(true);

      const cached = await fetchReviewPages(options);
      expect(cached.reviews.every((r) => r.text === null)).toBe(true);
    });

    it("keeps every other field, so nothing but the text is lost", async () => {
      const options = {
        productId: "p-fields",
        site: "amazon",
        cache: directReviewsCache,
        fetchPage: async () => [
          { rating: 4, text: "some text", date: "2026-02-03", verified: false, reviewerId: "r-9" },
        ],
        maxPages: 1,
        delay: async () => {},
      };
      await fetchReviewPages(options);
      const cached = await fetchReviewPages(options);
      expect(cached.reviews[0]).toEqual({
        rating: 4,
        text: null,
        date: "2026-02-03",
        verified: false,
        reviewerId: "r-9",
      });
    });

    it("hands back a signature for each cached review that had text", async () => {
      const options = {
        productId: "p-signature",
        site: "amazon",
        cache: directReviewsCache,
        fetchPage: async () => [review("a review with plenty of text to shingle over")],
        maxPages: 1,
        delay: async () => {},
      };
      await fetchReviewPages(options);
      const cached = await fetchReviewPages(options);
      const first = cached.reviews[0] as Review;
      expect(cached.signatures.get(first)).toHaveLength(128);
    });

    it("hands back no signature for a review that never had text", async () => {
      const options = {
        productId: "p-notextever",
        site: "amazon",
        cache: directReviewsCache,
        fetchPage: async () => [
          { rating: 5, text: null, date: "2026-01-01", verified: true, reviewerId: "r-1" },
        ],
        maxPages: 1,
        delay: async () => {},
      };
      await fetchReviewPages(options);
      const cached = await fetchReviewPages(options);
      expect(cached.signatures.get(cached.reviews[0] as Review)).toBeUndefined();
    });

    it("carries no signatures on a fresh fetch, where the text is still present", async () => {
      const fresh = await fetchReviewPages({
        productId: "p-fresh",
        site: "amazon",
        cache: directReviewsCache,
        fetchPage: async () => [review("text is right here, no need for a signature")],
        maxPages: 1,
        delay: async () => {},
      });
      expect(fresh.signatures.get(fresh.reviews[0] as Review)).toBeUndefined();
    });
  });

  describe("when paging goes wrong", () => {
    it("keeps the pages that already arrived when a later page throws", async () => {
      const fetchPage = vi.fn(async (page: number) => {
        if (page === 3) {
          throw new Error("rate limited");
        }
        return [review(`page ${page}`)];
      });
      const fetched = await fetchReviewPages({
        productId: "p-throws",
        site: "amazon",
        cache: directReviewsCache,
        fetchPage,
        maxPages: 5,
        delay: async () => {},
      });

      expect(fetched.stoppedBecause).toBe("failed");
      expect(fetched.reviews.map((r) => r.text)).toEqual(["page 1", "page 2"]);
    });

    it("stops paging once a page comes back empty", async () => {
      const fetchPage = vi.fn(async (page: number) => (page > 2 ? [] : [review(`page ${page}`)]));
      const fetched = await fetchReviewPages({
        productId: "p-empty",
        site: "amazon",
        cache: directReviewsCache,
        fetchPage,
        maxPages: 10,
        delay: async () => {},
      });

      expect(fetchPage).toHaveBeenCalledTimes(3);
      expect(fetched.stoppedBecause).toBe("exhausted");
    });

    it("stops rather than paging forever when the storefront repeats its last page", async () => {
      const fetchPage = vi.fn(async (page: number) => [review(`page ${Math.min(page, 3)}`)]);
      const fetched = await fetchReviewPages({
        productId: "p-repeats",
        site: "amazon",
        cache: directReviewsCache,
        fetchPage,
        maxPages: 20,
        delay: async () => {},
      });

      expect(fetchPage).toHaveBeenCalledTimes(4);
      expect(fetched.stoppedBecause).toBe("repeated");
      expect(fetched.reviews).toHaveLength(3);
    });

    it("caches nothing when the very first page fails, so a retry is still possible", async () => {
      const failing = vi.fn(async () => {
        throw new Error("offline");
      });
      const first = await fetchReviewPages({
        productId: "p-firstfails",
        site: "amazon",
        cache: directReviewsCache,
        fetchPage: failing,
        maxPages: 3,
        delay: async () => {},
      });
      expect(first.reviews).toEqual([]);

      const working = vi.fn(async (page: number) => [review(`page ${page}`)]);
      const second = await fetchReviewPages({
        productId: "p-firstfails",
        site: "amazon",
        cache: directReviewsCache,
        fetchPage: working,
        maxPages: 3,
        delay: async () => {},
      });
      expect(second.reviews).toHaveLength(3);
    });
  });

  describe("checking more deeply than the cached run", () => {
    it("fetches again when asked for more pages than the cache holds", async () => {
      const fetchPage = vi.fn(async (page: number) => [review(`page ${page}`)]);
      await fetchReviewPages({
        productId: "p-deeper",
        site: "amazon",
        cache: directReviewsCache,
        fetchPage,
        maxPages: 2,
        delay: async () => {},
      });
      expect(fetchPage).toHaveBeenCalledTimes(2);

      const deeper = await fetchReviewPages({
        productId: "p-deeper",
        site: "amazon",
        cache: directReviewsCache,
        fetchPage,
        maxPages: 6,
        delay: async () => {},
      });

      expect(fetchPage).toHaveBeenCalledTimes(8);
      expect(deeper.reviews).toHaveLength(6);
      expect(deeper.pagesFetched).toBe(6);
    });

    it("still serves the cache when the shallower depth is enough", async () => {
      const fetchPage = vi.fn(async (page: number) => [review(`page ${page}`)]);
      const options = {
        productId: "p-shallower",
        site: "amazon",
        cache: directReviewsCache,
        fetchPage,
        delay: async () => {},
      };
      await fetchReviewPages({ ...options, maxPages: 5 });
      await fetchReviewPages({ ...options, maxPages: 3 });

      expect(fetchPage).toHaveBeenCalledTimes(5);
    });
  });
});

describe("where the pages it read are kept", () => {
  function reviewsOn(page: number): Review[] {
    return [
      {
        rating: 5,
        text: `page ${page}`,
        date: "2026-01-01",
        verified: true,
        reviewerId: `r-${page}`,
      },
    ];
  }

  it("reads and writes through the cache it was given, not the page's own database", async () => {
    const read = vi.fn().mockResolvedValue(null);
    const write = vi.fn().mockResolvedValue(undefined);

    await fetchReviewPages({
      productId: "p-1",
      site: "amazon",
      maxPages: 2,
      delay: async () => {},
      fetchPage: async (page) => reviewsOn(page),
      cache: { read, write },
    });

    expect(read).toHaveBeenCalledWith("p-1", "amazon");
    expect(write).toHaveBeenCalledWith("p-1", "amazon", expect.any(Array), 2);
  });

  it("answers from the cache it was given when that run went deep enough", async () => {
    const cached = {
      reviews: reviewsOn(1),
      signatures: new WeakMap<Review, bigint[]>(),
      embeddings: new WeakMap<Review, number[]>(),
      cachedAt: Date.now(),
      pagesFetched: 5,
    };
    const fetchPage = vi.fn();

    const result = await fetchReviewPages({
      productId: "p-1",
      site: "amazon",
      maxPages: 2,
      fetchPage,
      cache: { read: async () => cached, write: async () => undefined },
    });

    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.stoppedBecause).toBe("complete");
  });
});
