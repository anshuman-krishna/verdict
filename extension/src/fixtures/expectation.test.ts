import { describe, expect, it } from "vitest";
import { ExpectationError, parseExpectation } from "./expectation";

const complete = {
  url: "https://www.amazon.fr/dp/B0ABCDEF12",
  layout: "modern",
  reviewCount: 8043,
  claimedRating: 4.6,
};

describe("parseExpectation", () => {
  it("reads a complete file", () => {
    const parsed = parseExpectation("a.json", JSON.stringify(complete));
    expect(parsed.url).toBe("https://www.amazon.fr/dp/B0ABCDEF12");
    expect(parsed.layout).toBe("modern");
    expect(parsed.reviewCount).toBe(8043);
    expect(parsed.claimedRating).toBe(4.6);
    expect(parsed.title).toBeUndefined();
    expect(parsed.knownFailure).toBeUndefined();
  });

  it("keeps null apart from absent", () => {
    const parsed = parseExpectation(
      "a.json",
      JSON.stringify({ ...complete, reviewCount: null, claimedRating: null }),
    );
    expect(parsed.reviewCount).toBeNull();
    expect(parsed.claimedRating).toBeNull();
  });

  it("rejects a file missing a required key rather than defaulting it", () => {
    const { claimedRating: _omitted, ...withoutRating } = complete;
    expect(() => parseExpectation("a.json", JSON.stringify(withoutRating))).toThrow(
      ExpectationError,
    );
  });

  it("rejects an unknown layout", () => {
    expect(() =>
      parseExpectation("a.json", JSON.stringify({ ...complete, layout: "mobile" })),
    ).toThrow(/layout/);
  });

  it("names the file in every error, since the corpus is read in bulk", () => {
    expect(() => parseExpectation("b0abcdef12.json", "{")).toThrow(/b0abcdef12\.json/);
  });

  it("rejects a string where a number belongs", () => {
    expect(() =>
      parseExpectation("a.json", JSON.stringify({ ...complete, reviewCount: "8043" })),
    ).toThrow(/reviewCount/);
  });

  it("rejects a json array", () => {
    expect(() => parseExpectation("a.json", "[]")).toThrow(/json object/);
  });

  it("carries the optional fields through when present", () => {
    const parsed = parseExpectation(
      "a.json",
      JSON.stringify({
        ...complete,
        title: "a product",
        category: "kitchen",
        minimumExtractedReviews: 8,
        knownFailure: "legacy pagination, tracked",
        notes: "seller changed in 2023",
      }),
    );
    expect(parsed.title).toBe("a product");
    expect(parsed.category).toBe("kitchen");
    expect(parsed.minimumExtractedReviews).toBe(8);
    expect(parsed.knownFailure).toBe("legacy pagination, tracked");
    expect(parsed.notes).toBe("seller changed in 2023");
  });
});
