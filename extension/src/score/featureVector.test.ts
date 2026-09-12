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
  parseFeatureVector,
  type FeatureVector,
} from "./featureVector";
import { flattenFeatureVector } from "./combine";

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
    expect(() => dayIndex("2024-03-15T10:00:00")).toThrow(/ambiguous zone/);
  });

  it.each([
    "3 janvier 2026",
    "3. Januar 2026",
    "Reviewed in the United States on January 3, 2026",
    "January 3, 2026",
    "03/01/2026",
  ])("rejects %s rather than reading it as a local date", (raw) => {
    expect(() => dayIndex(raw)).toThrow(/iso date/);
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
  it("assembles all five signals from raw reviews", () => {
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
    expect(result.listingDrift.embeddedCount).toBe(3);
    expect(result.meetsMinimumData).toBe(false);
  });

  it("passes the product text through to the drift signal", () => {
    const reviews: Review[] = [
      review({ text: "the kitchen knife set is sharp stainless steel", date: "2024-01-01" }),
      review({ text: "battery lasted two days on my phone", date: "2024-01-02" }),
    ];
    const inputs = { organicPrior: [0.2, 0.2, 0.2, 0.2, 0.2], injectionKernel: [0, 0, 0, 0.3, 0.7] };
    const withProduct = buildFeatureVector(reviews, {
      ...inputs,
      productText: "stainless steel kitchen knife set",
    });
    expect(withProduct.listingDrift.meanDistance).not.toBeNull();
    expect(withProduct.listingDrift.offTopicShare).not.toBeNull();
    const withoutProduct = buildFeatureVector(reviews, inputs);
    expect(withoutProduct.listingDrift.meanDistance).toBeNull();
    expect(withoutProduct.listingDrift.embeddedCount).toBe(2);
  });

  it("leaves rating deconvolution and temporal burst null when no review carries that data", () => {
    const reviews: Review[] = [review({ text: "some text with no rating or date at all here" })];
    const result = buildFeatureVector(reviews, { organicPrior: [0, 0, 0, 0, 0], injectionKernel: [0, 0, 0, 0, 0] });
    expect(result.ratingDeconvolution).toBeNull();
    expect(result.temporalBurst).toBeNull();
    expect(result.verificationConcentration).toBeNull();
  });
});

describe("the reviewer graph signal", () => {
  const reviews = (ids: string[]): Review[] =>
    ids.map((reviewerId, i) => ({
      rating: 5,
      text: `a review ${i}`,
      date: "2024-01-01",
      verified: true,
      reviewerId,
    }));

  it("is absent unless a lookup supplied its input", () => {
    const vector = buildFeatureVector(reviews(["a", "b"]), {
      organicPrior: [0.2, 0.2, 0.2, 0.2, 0.2],
      injectionKernel: [0, 0, 0, 0.35, 0.65],
    });
    expect(vector.reviewerGraph).toBeNull();
  });

  it("runs once a lookup supplied its input", () => {
    const vector = buildFeatureVector(reviews(["r0", "r1", "r2", "r3"]), {
      organicPrior: [0.2, 0.2, 0.2, 0.2, 0.2],
      injectionKernel: [0, 0, 0, 0.35, 0.65],
      flaggedReviewerIds: new Set(["r0", "r1"]),
    });
    expect(vector.reviewerGraph?.flaggedReviewShare).toBe(0.5);
  });

  it("distinguishes a lookup that found nothing from one that never happened", () => {
    const vector = buildFeatureVector(reviews(["a", "b"]), {
      organicPrior: [0.2, 0.2, 0.2, 0.2, 0.2],
      injectionKernel: [0, 0, 0, 0.35, 0.65],
      flaggedReviewerIds: new Set(),
    });
    expect(vector.reviewerGraph?.flaggedReviewShare).toBe(0);
  });
});

describe("parseFeatureVector", () => {
  const VECTOR = {
    meetsMinimumData: true,
    ratingDeconvolution: { injectedShare: 0.2, residualError: 0.01 },
    temporalBurst: { bursts: [{ start: 1, end: 2 }], burstFraction: 0.1, burstCount: 2, largestBurstShare: 0.05 },
    verificationConcentration: { lift: 1.8, baseCount: 40 },
    textNearDuplication: { duplicateReviewShare: 0.1, clusterCount: 2, largestClusterShare: 0.05 },
    listingDrift: {
      offTopicShare: 0.03,
      offTopicCount: 4,
      meanDistance: 0.4,
      changePoint: { day: 5 },
      driftStatistic: 1.2,
      embeddedCount: 90,
    },
    reviewerGraph: {
      flaggedReviewShare: 0.02,
      flaggedReviewCount: 3,
      flaggedReviewerCount: 2,
      knownReviewerCount: 100,
      identifiedReviewCount: 120,
    },
  };

  it("round trips a vector the scorer produced", () => {
    const parsed = parseFeatureVector(VECTOR);
    expect(parsed?.ratingDeconvolution).toEqual({ injectedShare: 0.2, residualError: 0.01 });
    expect(parsed?.verificationConcentration).toEqual({ lift: 1.8, baseCount: 40 });
    expect(parsed?.reviewerGraph?.flaggedReviewShare).toBe(0.02);
  });

  it("stays scoreable, which is the only thing a stored vector is for", () => {
    const parsed = parseFeatureVector(VECTOR);
    expect(() => flattenFeatureVector(parsed as FeatureVector)).not.toThrow();
  });

  it("accepts a signal that was genuinely absent", () => {
    const parsed = parseFeatureVector({ ...VECTOR, temporalBurst: null, reviewerGraph: null });
    expect(parsed?.temporalBurst).toBeNull();
    expect(parsed?.reviewerGraph).toBeNull();
  });

  it("refuses a signal that is present and unreadable rather than downgrading it", () => {
    expect(parseFeatureVector({ ...VECTOR, ratingDeconvolution: { injectedShare: 0.2 } })).toBeNull();
    expect(parseFeatureVector({ ...VECTOR, reviewerGraph: { flaggedReviewShare: 0.1 } })).toBeNull();
  });

  it("refuses a vector whose required leaves are missing", () => {
    expect(parseFeatureVector({ ...VECTOR, textNearDuplication: null })).toBeNull();
    expect(parseFeatureVector({ ...VECTOR, listingDrift: {} })).toBeNull();
  });

  it("refuses a non finite number, which would score as NaN", () => {
    const broken = { ...VECTOR, listingDrift: { ...VECTOR.listingDrift, driftStatistic: "high" } };
    expect(parseFeatureVector(broken)).toBeNull();
  });

  it("refuses anything that is not a vector", () => {
    expect(parseFeatureVector(null)).toBeNull();
    expect(parseFeatureVector([])).toBeNull();
    expect(parseFeatureVector({ meetsMinimumData: "yes" })).toBeNull();
  });

  it("keeps a nullable leaf as null", () => {
    const parsed = parseFeatureVector({
      ...VECTOR,
      textNearDuplication: { ...VECTOR.textNearDuplication, duplicateReviewShare: null },
      verificationConcentration: { lift: null, baseCount: 0 },
    });
    expect(parsed?.textNearDuplication.duplicateReviewShare).toBeNull();
    expect(parsed?.verificationConcentration?.lift).toBeNull();
  });
});
