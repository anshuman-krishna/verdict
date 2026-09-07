// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { syntheticProductPageHtml, syntheticReviews } from "./syntheticLoad";

describe("syntheticReviews", () => {
  it("produces the requested count", () => {
    expect(syntheticReviews({ count: 25 })).toHaveLength(25);
  });

  // a timing regression has to be re-measurable against the same load, or
  // the measurement is just noise about which reviews happened to be built.
  it("is deterministic for a seed", () => {
    expect(syntheticReviews({ count: 20, seed: 7 })).toEqual(syntheticReviews({ count: 20, seed: 7 }));
  });

  it("differs between seeds", () => {
    expect(syntheticReviews({ count: 20, seed: 7 })).not.toEqual(
      syntheticReviews({ count: 20, seed: 8 }),
    );
  });

  it("fills every field, so no signal is skipped for lack of data", () => {
    for (const review of syntheticReviews({ count: 30, seed: 3 })) {
      expect(review.rating).toBeGreaterThanOrEqual(1);
      expect(review.rating).toBeLessThanOrEqual(5);
      expect(review.text).not.toBe("");
      expect(review.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof review.verified).toBe("boolean");
      expect(review.reviewerId).not.toBeNull();
    }
  });

  it("repeats some text, which is what the duplication clustering costs time on", () => {
    const reviews = syntheticReviews({ count: 200, seed: 5, duplicateShare: 0.4 });
    const distinct = new Set(reviews.map((review) => review.text));
    expect(distinct.size).toBeLessThan(reviews.length);
  });

  it("writes no duplicates at all when asked for none", () => {
    const reviews = syntheticReviews({ count: 100, seed: 5, duplicateShare: 0 });
    expect(new Set(reviews.map((review) => review.text)).size).toBe(reviews.length);
  });
});

describe("syntheticProductPageHtml", () => {
  it("embeds the reviews where an embedded-json rule can find them", () => {
    const reviews = syntheticReviews({ count: 3, seed: 1 });
    const container = document.createElement("div");
    container.innerHTML = syntheticProductPageHtml(reviews, "a product");
    const script = container.querySelector('script[type="application/ld+json"]');
    const payload = JSON.parse(script?.textContent ?? "{}");
    expect(payload.title).toBe("a product");
    expect(payload.reviews).toHaveLength(3);
    expect(payload.reviewCount).toBe("3");
  });
});
