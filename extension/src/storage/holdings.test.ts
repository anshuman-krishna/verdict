import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { enqueueContributionEdges, clearContributionQueue } from "../graph/queue";
import type { Review } from "../extract/types";
import { addHistoryEntry, deleteAllHistory } from "./history";
import { cacheLine, checksLine, contributionLine, readHoldings, type Holdings } from "./holdings";
import { clearReviewsCache, setCachedReviews } from "./reviewsCache";

const NOW = Date.parse("2026-03-01T12:00:00Z");

const NOTHING: Holdings = {
  checks: 0,
  cachedProducts: 0,
  oldestCachedAt: null,
  queuedContributions: 0,
  nextContributionAt: null,
};

const review: Review = {
  rating: 5,
  text: "a review with enough words in it to shingle over properly",
  date: "2026-01-01",
  verified: true,
  reviewerId: "r-1",
};

const edge = {
  reviewerHash: "a".repeat(64),
  productHash: "b".repeat(64),
  starRating: 5,
  weekBucket: 2800,
  verified: true,
  minhashSignature: [],
};

beforeEach(async () => {
  await deleteAllHistory();
  await clearReviewsCache();
  await clearContributionQueue();
});

describe("readHoldings", () => {
  it("reports nothing held on a browser that has done nothing", async () => {
    await expect(readHoldings()).resolves.toEqual(NOTHING);
  });

  it("counts the checks, the cached listings, and the queued rows", async () => {
    await addHistoryEntry({ title: "a", thumbnailUrl: null, report: null });
    await setCachedReviews("p-1", "amazon", [review], 1);
    await setCachedReviews("p-2", "amazon", [review], 1);
    await enqueueContributionEdges([edge, edge]);

    const holdings = await readHoldings();

    expect(holdings.checks).toBe(1);
    expect(holdings.cachedProducts).toBe(2);
    expect(holdings.queuedContributions).toBe(2);
  });

  it("reports when the oldest cached listing was read", async () => {
    await setCachedReviews("p-1", "amazon", [review], 1);
    const holdings = await readHoldings();
    expect(holdings.oldestCachedAt).toEqual(expect.any(Number));
  });

  it("reports the soonest a queued row could leave, not the latest", async () => {
    await enqueueContributionEdges([edge], () => 1_000_000, () => 0);
    await enqueueContributionEdges([edge], () => 1_000_000, () => 1);

    const holdings = await readHoldings();

    expect(holdings.nextContributionAt).toBe(1_000_000 + 60 * 60 * 1000);
  });

  it("reports no send time at all once the queue is empty", async () => {
    await enqueueContributionEdges([edge]);
    await clearContributionQueue();
    await expect(readHoldings()).resolves.toMatchObject({ nextContributionAt: null });
  });
});

describe("the lines the options page reads", () => {
  it("counts one check as one", () => {
    expect(checksLine({ ...NOTHING, checks: 1 })).toBe("1 check saved.");
  });

  it("groups a large count of checks", () => {
    expect(checksLine({ ...NOTHING, checks: 12345 })).toBe("12,345 checks saved.");
  });

  it("says what the cache holds and what it does not", () => {
    expect(cacheLine({ ...NOTHING, cachedProducts: 1, oldestCachedAt: NOW }, NOW)).toBe(
      "1 listing held, without review text. The oldest was read today.",
    );
  });

  it("names yesterday rather than one day ago", () => {
    expect(
      cacheLine({ ...NOTHING, cachedProducts: 2, oldestCachedAt: NOW - 86_400_000 }, NOW),
    ).toContain("read yesterday");
  });

  it("says how long the cache is kept when it is empty", () => {
    expect(cacheLine(NOTHING, NOW)).toContain("seven days");
  });

  it("says nothing is waiting when nothing is", () => {
    expect(contributionLine(NOTHING, NOW)).toBe("Nothing waiting to be sent.");
  });

  it("counts one queued row as one", () => {
    expect(
      contributionLine({ ...NOTHING, queuedContributions: 1, nextContributionAt: NOW + 60_000 }, NOW),
    ).toBe("1 hashed row waiting to be sent. The first leaves in about 1 minute.");
  });

  it("rounds a wait of hours to hours", () => {
    expect(
      contributionLine(
        { ...NOTHING, queuedContributions: 9, nextContributionAt: NOW + 5 * 60 * 60 * 1000 },
        NOW,
      ),
    ).toContain("in about 5 hours");
  });

  it("says a row already due leaves on the next send, never a time in the past", () => {
    expect(
      contributionLine(
        { ...NOTHING, queuedContributions: 9, nextContributionAt: NOW - 60 * 60 * 1000 },
        NOW,
      ),
    ).toContain("on the next send");
  });
});
