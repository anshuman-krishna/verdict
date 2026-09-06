import { describe, expect, it } from "vitest";
import {
  estimateJaccard,
  exactJaccard,
  fnv1a64,
  minhashSignature,
  shingle,
  textNearDuplication,
  type ReviewForNearDuplication,
} from "./textNearDuplication";

function review(text: string | null): ReviewForNearDuplication {
  return { text };
}

describe("fnv1a64", () => {
  it("is deterministic for the same input", () => {
    expect(fnv1a64("a review of a good product")).toBe(fnv1a64("a review of a good product"));
  });

  it("differs for different input", () => {
    expect(fnv1a64("abc")).not.toBe(fnv1a64("abd"));
  });
});

describe("shingle", () => {
  it("produces every overlapping 5 character window", () => {
    // "hello" is exactly 5 characters, so it is a single shingle
    expect(shingle("hello", 5)).toEqual(new Set(["hello"]));
    // "helloo" (6 chars) produces two overlapping windows
    expect(shingle("helloo", 5)).toEqual(new Set(["hello", "elloo"]));
  });

  it("lowercases and collapses whitespace before shingling", () => {
    expect(shingle("HELLO", 5)).toEqual(new Set(["hello"]));
    expect(shingle("a    b", 5)).toEqual(shingle("a b", 5));
  });

  it("treats text shorter than the shingle size as a single shingle", () => {
    expect(shingle("hi", 5)).toEqual(new Set(["hi"]));
  });
});

describe("exactJaccard", () => {
  it("hand computed: two sets sharing 2 of 4 union members", () => {
    // {a,b,c} union {b,c,d} = {a,b,c,d}, intersection = {b,c}, 2/4 = 0.5
    expect(exactJaccard(new Set(["a", "b", "c"]), new Set(["b", "c", "d"]))).toBe(0.5);
  });

  it("is 1 for two empty sets and 0 for disjoint sets", () => {
    expect(exactJaccard(new Set(), new Set())).toBe(1);
    expect(exactJaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });
});

describe("minhashSignature", () => {
  it("is identical for identical shingle sets", () => {
    const shingles = shingle("this product works exactly as described", 5);
    expect(minhashSignature(shingles, 16)).toEqual(minhashSignature(shingles, 16));
  });

  it("gives an estimated jaccard of exactly 1 for identical signatures", () => {
    const signature = minhashSignature(shingle("identical text here", 5), 32);
    expect(estimateJaccard(signature, signature)).toBe(1);
  });

  it("gives an estimated jaccard of 0 for shingle sets sharing no characters", () => {
    const digits = minhashSignature(shingle("00000 11111 22222 33333", 5), 32);
    const letters = minhashSignature(shingle("aaaaa bbbbb ccccc ddddd", 5), 32);
    expect(estimateJaccard(digits, letters)).toBe(0);
  });
});

describe("textNearDuplication", () => {
  it("clusters exact duplicate reviews and leaves unique ones out", () => {
    const reviews = [
      review("works great, exactly as advertised, would buy again"),
      review("works great, exactly as advertised, would buy again"),
      review("works great, exactly as advertised, would buy again"),
      review("this is a completely different review about a totally different item"),
      review("nothing at all like the others, unique wording throughout this one"),
    ];
    const result = textNearDuplication(reviews);
    // 3 identical reviews out of 5 eligible reviews form the one cluster
    expect(result.clusterCount).toBe(1);
    expect(result.duplicateReviewShare).toBeCloseTo(3 / 5, 10);
    expect(result.largestClusterShare).toBeCloseTo(3 / 5, 10);
  });

  it("finds no clusters when every review is unique", () => {
    const reviews = [
      review("the packaging was excellent and arrived a day early"),
      review("battery life is shorter than the listing claims outright"),
      review("customer support resolved my question within an hour today"),
    ];
    const result = textNearDuplication(reviews);
    expect(result.clusterCount).toBe(0);
    expect(result.duplicateReviewShare).toBe(0);
    expect(result.largestClusterShare).toBe(0);
  });

  it("excludes reviews with null or empty text from the denominator", () => {
    const reviews = [
      review("a genuine review with real detail about the product"),
      review(null),
      review(""),
      review("a second, entirely different genuine review here"),
    ];
    const result = textNearDuplication(reviews);
    // only the two non-null, non-empty reviews are eligible
    expect(result.clusterCount).toBe(0);
    expect(result.duplicateReviewShare).toBe(0);
  });

  it("returns null for fewer than 2 eligible reviews", () => {
    expect(textNearDuplication([])).toEqual({
      duplicateReviewShare: null,
      clusterCount: 0,
      largestClusterShare: 0,
    });
    expect(textNearDuplication([review("only one review here")])).toEqual({
      duplicateReviewShare: 0,
      clusterCount: 0,
      largestClusterShare: 0,
    });
  });

  it("forms two separate clusters for two distinct groups of duplicates", () => {
    const reviews = [
      review("group one duplicate text appears here word for word"),
      review("group one duplicate text appears here word for word"),
      review("group two duplicate text is completely different from group one"),
      review("group two duplicate text is completely different from group one"),
      review("a lone unique review that matches nothing else at all"),
    ];
    const result = textNearDuplication(reviews);
    expect(result.clusterCount).toBe(2);
    expect(result.duplicateReviewShare).toBeCloseTo(4 / 5, 10);
    expect(result.largestClusterShare).toBeCloseTo(2 / 5, 10);
  });

  describe("signatureCache", () => {
    it("produces the exact same result whether or not a cache is supplied", () => {
      const reviews = [
        review("group one duplicate text appears here word for word"),
        review("group one duplicate text appears here word for word"),
        review("a lone unique review that matches nothing else at all"),
      ];
      const cache = new WeakMap<ReviewForNearDuplication, bigint[]>();
      expect(textNearDuplication(reviews, { signatureCache: cache })).toEqual(
        textNearDuplication(reviews),
      );
    });

    it("reuses a cached signature instead of recomputing it for the same review object", () => {
      const shared = review("this exact review object gets reused across two calls");
      const cache = new WeakMap<ReviewForNearDuplication, bigint[]>();

      textNearDuplication([shared, review("something else entirely, no overlap")], {
        signatureCache: cache,
      });
      const signatureAfterFirstCall = cache.get(shared);
      expect(signatureAfterFirstCall).toBeDefined();

      // mutating the cached entry proves the second call reads it back
      // rather than recomputing: a freshly computed signature would
      // never match this corrupted value.
      cache.set(shared, [999999n]);
      const result = textNearDuplication([shared, review("a third, different review text")], {
        signatureCache: cache,
      });
      expect(cache.get(shared)).toEqual([999999n]);
      // with a corrupted 1 element signature, minhash similarity against
      // anything else drops to near zero, so this must not cluster
      expect(result.clusterCount).toBe(0);
    });

    it("populates the cache for every eligible review it computes a signature for", () => {
      const a = review("first review with plenty of unique words to shingle");
      const b = review("second review with a totally different set of words");
      const cache = new WeakMap<ReviewForNearDuplication, bigint[]>();

      textNearDuplication([a, b], { signatureCache: cache });

      expect(cache.get(a)).toBeInstanceOf(Array);
      expect(cache.get(b)).toBeInstanceOf(Array);
    });
  });
});
