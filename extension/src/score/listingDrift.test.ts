import { describe, expect, it } from "vitest";
import {
  centroidChangePoint,
  listingIdentityDrift,
  MINIMUM_CHANGE_POINT_REVIEWS,
  MINIMUM_REPORTABLE_DRIFT,
  type ReviewForDrift,
} from "./listingDrift";
import { embedText } from "./textEmbedding";

const KNIFE = "stainless steel kitchen knife set";

function knifeReview(index: number): ReviewForDrift {
  return { text: `the kitchen knife set holds an edge, sharp stainless steel, review ${index}` };
}

function cableReview(index: number): ReviewForDrift {
  return { text: `charging cable arrived quickly and my phone battery fills fast, note ${index}` };
}

function days(count: number, from = 20000): (number | null)[] {
  return Array.from({ length: count }, (_, i) => from + i);
}

describe("listingIdentityDrift", () => {
  it("reports nothing when no review carries text", () => {
    const result = listingIdentityDrift([{ text: null }, { text: "" }], [null, null], KNIFE);
    expect(result.offTopicShare).toBeNull();
    expect(result.meanDistance).toBeNull();
    expect(result.embeddedCount).toBe(0);
    expect(result.changePoint).toBeNull();
  });

  it("counts no review as off topic when every one matches the listing", () => {
    const reviews = Array.from({ length: 20 }, (_, i) => knifeReview(i));
    const result = listingIdentityDrift(reviews, days(20), KNIFE);
    expect(result.offTopicCount).toBe(0);
    expect(result.offTopicShare).toBe(0);
    expect(result.meanDistance).toBeLessThan(1);
  });

  it("counts reviews that share nothing with the listing", () => {
    const reviews = [...Array.from({ length: 10 }, (_, i) => knifeReview(i)), cableReview(0)];
    const result = listingIdentityDrift(reviews, days(11), KNIFE);
    expect(result.offTopicCount).toBe(1);
    expect(result.offTopicShare).toBeCloseTo(1 / 11, 12);
  });

  it("leaves offTopicShare null when there is no product text, and still runs the change point", () => {
    const reviews = [
      ...Array.from({ length: 12 }, (_, i) => knifeReview(i)),
      ...Array.from({ length: 12 }, (_, i) => cableReview(i)),
    ];
    const result = listingIdentityDrift(reviews, days(24), "");
    expect(result.offTopicShare).toBeNull();
    expect(result.offTopicCount).toBe(0);
    expect(result.changePoint).not.toBeNull();
  });

  it("dates the change point at the first review of the later segment", () => {
    const reviews = [
      ...Array.from({ length: 15 }, (_, i) => knifeReview(i)),
      ...Array.from({ length: 15 }, (_, i) => cableReview(i)),
    ];
    const result = listingIdentityDrift(reviews, days(30, 20000), KNIFE);
    expect(result.changePoint?.day).toBe(20015);
    expect(result.changePoint?.afterCount).toBe(15);
    expect(result.driftStatistic).toBeGreaterThan(0.9);
  });

  it("dates nothing on a listing that never changed subject", () => {
    const steady = Array.from({ length: 30 }, (_, i) => knifeReview(i));
    const result = listingIdentityDrift(steady, days(30), KNIFE);
    expect(result.changePoint).toBeNull();
    expect(result.driftStatistic).toBeLessThan(MINIMUM_REPORTABLE_DRIFT);
  });

  it("orders by date rather than by position, so a shuffled set gives the same change point", () => {
    const ordered = [
      ...Array.from({ length: 15 }, (_, i) => knifeReview(i)),
      ...Array.from({ length: 15 }, (_, i) => cableReview(i)),
    ];
    const orderedDays = days(30);
    const indices = ordered.map((_, i) => i).reverse();
    const shuffled = indices.map((i) => ordered[i] as ReviewForDrift);
    const shuffledDays = indices.map((i) => orderedDays[i] as number);
    expect(listingIdentityDrift(shuffled, shuffledDays, KNIFE).changePoint).toEqual(
      listingIdentityDrift(ordered, orderedDays, KNIFE).changePoint,
    );
  });

  it("finds no change point below the minimum, however different the two halves are", () => {
    const count = MINIMUM_CHANGE_POINT_REVIEWS - 1;
    const reviews = [
      ...Array.from({ length: Math.floor(count / 2) }, (_, i) => knifeReview(i)),
      ...Array.from({ length: Math.ceil(count / 2) }, (_, i) => cableReview(i)),
    ];
    const result = listingIdentityDrift(reviews, days(count), KNIFE);
    expect(result.changePoint).toBeNull();
    expect(result.driftStatistic).toBe(0);
  });

  it("ignores undated reviews in the change point but still measures their distance", () => {
    const reviews = Array.from({ length: 20 }, (_, i) => knifeReview(i));
    const undated = new Array<number | null>(20).fill(null);
    const result = listingIdentityDrift(reviews, undated, KNIFE);
    expect(result.embeddedCount).toBe(20);
    expect(result.changePoint).toBeNull();
  });

  it("scores a cached review from its seeded embedding, with no text", () => {
    const withText = Array.from({ length: 20 }, (_, i) => knifeReview(i));
    const stripped: ReviewForDrift[] = withText.map(() => ({ text: null }));
    const cache = new WeakMap<ReviewForDrift, number[]>();
    stripped.forEach((review, i) => {
      cache.set(review, embedText((withText[i] as ReviewForDrift).text as string) as number[]);
    });
    expect(listingIdentityDrift(stripped, days(20), KNIFE, { embeddingCache: cache })).toEqual(
      listingIdentityDrift(withText, days(20), KNIFE),
    );
  });

  it("ignores a seeded embedding of the wrong width", () => {
    const review: ReviewForDrift = { text: null };
    const cache = new WeakMap<ReviewForDrift, number[]>([[review, [1, 0, 0]]]);
    expect(listingIdentityDrift([review], [null], KNIFE, { embeddingCache: cache }).embeddedCount)
      .toBe(0);
  });
});

describe("centroidChangePoint", () => {
  it("finds no drift when every embedding is the same", () => {
    const embedding = embedText("one and the same") as number[];
    const dated = Array.from({ length: 20 }, (_, i) => ({ embedding, day: 20000 + i }));
    const result = centroidChangePoint(dated);
    expect(result.changePoint).toBeNull();
    expect(result.driftStatistic).toBeCloseTo(0, 12);
  });

  it("leaves no room for a split when every candidate is inside a minimum segment", () => {
    const embedding = embedText("one and the same") as number[];
    const dated = Array.from({ length: 11 }, (_, i) => ({ embedding, day: 20000 + i }));
    expect(centroidChangePoint(dated)).toEqual({ changePoint: null, driftStatistic: 0 });
  });
});
