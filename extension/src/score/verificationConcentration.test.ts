import { describe, expect, it } from "vitest";
import { verificationConcentration, type ReviewForVerification } from "./verificationConcentration";

function review(
  rating: number | null,
  verified: boolean | null,
  insideBurst: boolean,
): ReviewForVerification {
  return { rating, verified, insideBurst };
}

describe("verificationConcentration", () => {
  it("computes a lift of 2 when the burst stratum is twice as unverified as overall", () => {
    const reviews: ReviewForVerification[] = [
      review(5, false, true),
      review(5, false, true),
      review(5, false, true),
      review(5, false, true),
      review(5, true, true),
      review(3, true, false),
      review(3, true, false),
      review(3, true, false),
      review(3, true, false),
      review(3, true, false),
    ];
    const result = verificationConcentration(reviews);
    expect(result.baseCount).toBe(5);
    expect(result.lift).toBeCloseTo(2, 10);
  });

  it("excludes reviews with unknown verification status entirely", () => {
    const reviews: ReviewForVerification[] = [
      review(5, false, true),
      review(5, false, true),
      review(5, false, true),
      review(5, false, true),
      review(5, true, true),
      review(3, true, false),
      review(3, true, false),
      review(3, true, false),
      review(3, true, false),
      review(3, true, false),
      review(5, null, true),
      review(3, null, false),
    ];
    const result = verificationConcentration(reviews);
    expect(result.baseCount).toBe(5);
    expect(result.lift).toBeCloseTo(2, 10);
  });

  it("returns null when nothing falls in the five star inside burst stratum", () => {
    const reviews: ReviewForVerification[] = [
      review(5, false, false),
      review(3, true, true),
      review(4, false, true),
    ];
    const result = verificationConcentration(reviews);
    expect(result.baseCount).toBe(0);
    expect(result.lift).toBeNull();
  });

  it("returns null when there is no unverified baseline to compare against", () => {
    const reviews: ReviewForVerification[] = [
      review(5, true, true),
      review(3, true, false),
    ];
    const result = verificationConcentration(reviews);
    expect(result.lift).toBeNull();
  });

  it("returns null and a zero base count for an empty review set", () => {
    const result = verificationConcentration([]);
    expect(result).toEqual({ lift: null, baseCount: 0 });
  });
});
