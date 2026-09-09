import { describe, expect, it } from "vitest";
import { reviewerGraphShare } from "./reviewerGraph";

function reviews(ids: (string | null)[]) {
  return ids.map((reviewerId) => ({ reviewerId }));
}

describe("reviewerGraphShare", () => {
  it("reports the share of reviews written by flagged accounts", () => {
    const result = reviewerGraphShare(reviews(["a", "b", "c", "d"]), new Set(["a", "c"]));
    expect(result.flaggedReviewShare).toBe(0.5);
    expect(result.flaggedReviewCount).toBe(2);
    expect(result.identifiedReviewCount).toBe(4);
  });

  it("counts reviews, not reviewers, while reporting both", () => {
    const result = reviewerGraphShare(reviews(["a", "a", "a", "b"]), new Set(["a"]));
    expect(result.flaggedReviewShare).toBe(0.75);
    expect(result.flaggedReviewerCount).toBe(1);
    expect(result.knownReviewerCount).toBe(2);
  });

  it("skips reviews with no reviewer id rather than counting them as unflagged", () => {
    const result = reviewerGraphShare(reviews(["a", null, null]), new Set(["a"]));
    expect(result.flaggedReviewShare).toBe(1);
    expect(result.identifiedReviewCount).toBe(1);
  });

  it("reports a null share when no review carries a reviewer id", () => {
    const result = reviewerGraphShare(reviews([null, null]), new Set(["a"]));
    expect(result.flaggedReviewShare).toBeNull();
    expect(result.identifiedReviewCount).toBe(0);
  });

  it("reports zero rather than null when the lookup found nothing", () => {
    const result = reviewerGraphShare(reviews(["a", "b"]), new Set());
    expect(result.flaggedReviewShare).toBe(0);
    expect(result.flaggedReviewerCount).toBe(0);
  });

  it("ignores flagged ids that do not appear on this listing", () => {
    const result = reviewerGraphShare(reviews(["a"]), new Set(["a", "x", "y"]));
    expect(result.flaggedReviewerCount).toBe(1);
    expect(result.knownReviewerCount).toBe(1);
  });

  it("handles an empty review set", () => {
    expect(reviewerGraphShare([], new Set(["a"])).flaggedReviewShare).toBeNull();
  });
});
