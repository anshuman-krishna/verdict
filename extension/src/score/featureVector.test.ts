import { describe, expect, it } from "vitest";
import type { Review } from "../extract/types";
import {
  buildDailyCounts,
  buildFeatureVector,
  buildRatingHistogram,
  dayIndex,
  deriveInsideBurst,
  meetsMinimumDataThresholds,
  MINIMUM_DATED_REVIEW_COUNT,
  MINIMUM_HISTORY_DAYS,
  MINIMUM_REVIEW_COUNT,
} from "./featureVector";

function review(overrides: Partial<Review> = {}): Review {
  return { rating: null, text: null, date: null, verified: null, reviewerId: null, ...overrides };
}

describe("dayIndex", () => {
  it("hand computed: 2024-03-15 is 19797 days after the epoch", () => {
    expect(dayIndex("2024-03-15")).toBe(19797);
  });

  it("agrees for a date-only string and its utc midnight equivalent", () => {
    expect(dayIndex("2024-03-15")).toBe(dayIndex("2024-03-15T00:00:00Z"));
  });

  it("rejects a datetime string with no explicit time zone", () => {
    expect(() => dayIndex("2024-03-15T10:00:00")).toThrow(/explicit time zone/);
  });
});

describe("meetsMinimumDataThresholds", () => {
  it("hand computed: fails below the minimum review count", () => {
    const reviews = Array.from({ length: MINIMUM_REVIEW_COUNT - 1 }, () =>
      review({ date: "2024-01-01" }),
    );
    expect(meetsMinimumDataThresholds(reviews)).toBe(false);
  });

  it("hand computed: fails below the minimum dated review count even with enough total reviews", () => {
    const dated = Array.from({ length: MINIMUM_DATED_REVIEW_COUNT - 1 }, () =>
      review({ date: "2024-01-01" }),
    );
    const undated = Array.from({ length: MINIMUM_REVIEW_COUNT - dated.length }, () => review());
    expect(meetsMinimumDataThresholds([...dated, ...undated])).toBe(false);
  });

  it("hand computed: fails when the dated history spans less than 21 days", () => {
    const reviews = Array.from({ length: MINIMUM_REVIEW_COUNT }, (_, i) =>
      review({ date: i < MINIMUM_DATED_REVIEW_COUNT ? "2024-01-01" : null }),
    );
    // every dated review lands on the same day, so the span is 0
    expect(meetsMinimumDataThresholds(reviews)).toBe(false);
  });

  it("hand computed: passes when every threshold is exactly met", () => {
    const reviews = Array.from({ length: MINIMUM_REVIEW_COUNT }, (_, i) => {
      if (i === 0) return review({ date: "2024-01-01" });
      if (i === 1) return review({ date: `2024-01-${1 + MINIMUM_HISTORY_DAYS}` });
      return review({ date: i < MINIMUM_DATED_REVIEW_COUNT ? "2024-01-05" : null });
    });
    expect(meetsMinimumDataThresholds(reviews)).toBe(true);
  });
});

describe("buildRatingHistogram", () => {
  it("hand computed: 2 five star and 2 one star reviews split 0.5/0/0/0/0.5", () => {
    const reviews = [
      review({ rating: 5 }),
      review({ rating: 5 }),
      review({ rating: 1 }),
      review({ rating: 1 }),
    ];
    expect(buildRatingHistogram(reviews)).toEqual([0.5, 0, 0, 0, 0.5]);
  });

  it("returns null when no review carries a rating", () => {
    expect(buildRatingHistogram([review(), review()])).toBeNull();
  });

  it("ignores unrated reviews when computing proportions", () => {
    const reviews = [review({ rating: 5 }), review({ rating: 5 }), review()];
    expect(buildRatingHistogram(reviews)).toEqual([0, 0, 0, 0, 1]);
  });
});

describe("buildDailyCounts", () => {
  it("hand computed: two reviews on day 0 and one three days later", () => {
    const reviews = [
      review({ date: "2024-01-01" }),
      review({ date: "2024-01-01" }),
      review({ date: "2024-01-04" }),
    ];
    const result = buildDailyCounts(reviews);
    expect(result?.dailyCounts).toEqual([2, 0, 0, 1]);
  });

  it("returns null when no review is dated", () => {
    expect(buildDailyCounts([review(), review()])).toBeNull();
  });
});

describe("deriveInsideBurst", () => {
  it("hand computed: a review on day 2 is inside a burst spanning days 1 to 3", () => {
    const reviews = [review({ date: "2024-01-03" }), review({ date: "2024-01-10" })];
    const minDay = dayIndex("2024-01-01");
    const result = deriveInsideBurst(reviews, minDay, [{ startDay: 1, endDay: 3, reviewCount: 5 }]);
    expect(result).toEqual([true, false]);
  });

  it("treats an undated review as never inside a burst", () => {
    const result = deriveInsideBurst([review()], 0, [{ startDay: 0, endDay: 100, reviewCount: 1 }]);
    expect(result).toEqual([false]);
  });
});

describe("buildFeatureVector", () => {
  it("assembles all four signals from raw reviews", () => {
    const reviews: Review[] = [
      review({ rating: 5, text: "great product, works well", date: "2024-01-01", verified: true }),
      review({ rating: 5, text: "great product, works well", date: "2024-01-01", verified: false }),
      review({ rating: 1, text: "did not work for me at all", date: "2024-01-20", verified: true }),
    ];
    const result = buildFeatureVector(reviews, {
      organicPrior: [0.1, 0.1, 0.2, 0.3, 0.3],
      injectionKernel: [0, 0, 0, 0.3, 0.7],
    });
    expect(result.ratingDeconvolution).not.toBeNull();
    expect(result.temporalBurst).not.toBeNull();
    expect(result.textNearDuplication.clusterCount).toBe(1);
    expect(result.meetsMinimumData).toBe(false);
  });

  it("leaves rating deconvolution and temporal burst null when no review carries that data", () => {
    const reviews: Review[] = [review({ text: "some text with no rating or date at all here" })];
    const result = buildFeatureVector(reviews, { organicPrior: [0, 0, 0, 0, 0], injectionKernel: [0, 0, 0, 0, 0] });
    expect(result.ratingDeconvolution).toBeNull();
    expect(result.temporalBurst).toBeNull();
    expect(result.verificationConcentration).toBeNull();
  });
});
