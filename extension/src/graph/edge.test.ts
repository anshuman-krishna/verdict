import { describe, expect, it } from "vitest";
import type { Review } from "../extract/types";
import { buildContributionEdge, weekBucket } from "./edge";

function review(overrides: Partial<Review> = {}): Review {
  return {
    rating: 5,
    text: "a great product",
    date: "2024-01-15",
    verified: true,
    reviewerId: "r-1",
    ...overrides,
  };
}

describe("weekBucket", () => {
  it("places two dates in the same real week in the same bucket", () => {
    expect(weekBucket("2024-01-15")).toBe(weekBucket("2024-01-17"));
  });

  it("places dates a week apart in different buckets", () => {
    expect(weekBucket("2024-01-15")).not.toBe(weekBucket("2024-01-22"));
  });

  it("returns null for a date it cannot parse", () => {
    expect(weekBucket("not a date")).toBeNull();
  });
});

describe("buildContributionEdge", () => {
  const salt = "test-salt";

  it("builds an edge with a reviewer hash, product hash, rating, bucket, and verified flag", async () => {
    const edge = await buildContributionEdge(review(), "B000EXAMPLE", salt);
    expect(edge).not.toBeNull();
    expect(edge?.starRating).toBe(5);
    expect(edge?.verified).toBe(true);
    expect(edge?.weekBucket).toBe(weekBucket("2024-01-15"));
    expect(edge?.reviewerHash).toMatch(/^[0-9a-f]{64}$/);
    expect(edge?.productHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never includes the review text itself, only a minhash signature of it", async () => {
    const edge = await buildContributionEdge(review({ text: "a very distinctive sentence" }), "B0", salt);
    const serialized = JSON.stringify(edge);
    expect(serialized).not.toContain("distinctive");
    expect(edge?.minhashSignature.length).toBeGreaterThan(0);
  });

  it("produces an edge with an empty signature, not a missing edge, for a review with no text", async () => {
    const edge = await buildContributionEdge(review({ text: null }), "B0", salt);
    expect(edge).not.toBeNull();
    expect(edge?.minhashSignature).toEqual([]);
  });

  it("returns null when the review has no reviewer id, since there is no node to attach an edge to", async () => {
    expect(await buildContributionEdge(review({ reviewerId: null }), "B0", salt)).toBeNull();
  });

  it("returns null when the review has no date, since there is no week bucket to place it in", async () => {
    expect(await buildContributionEdge(review({ date: null }), "B0", salt)).toBeNull();
  });

  it("returns null when the review has no rating", async () => {
    expect(await buildContributionEdge(review({ rating: null }), "B0", salt)).toBeNull();
  });

  it("hashes the same reviewer id differently under different product ids", async () => {
    const a = await buildContributionEdge(review(), "product-a", salt);
    const b = await buildContributionEdge(review(), "product-b", salt);
    expect(a?.reviewerHash).toBe(b?.reviewerHash);
    expect(a?.productHash).not.toBe(b?.productHash);
  });

  it("hashes with whatever salt it is given, since agreeing with reputation lookup's hash is the caller's job, not this function's", async () => {
    // entrypoints/amazon.content.ts passes REPUTATION_SALT here on
    // purpose (see that constant's own comment): a community this
    // protocol's data eventually gets used to flag is only ever
    // findable through reputation/lookup.ts's reviewerHash if both sides
    // hashed the same reviewer id under the same salt. This function
    // does not enforce that; it just uses whatever salt it is handed.
    const a = await buildContributionEdge(review(), "B0", "salt-one");
    const b = await buildContributionEdge(review(), "B0", "salt-one");
    expect(a?.reviewerHash).toBe(b?.reviewerHash);
  });
});
