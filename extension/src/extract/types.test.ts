import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import schema from "../../../schema/verdict.schema.json";
import productSnapshotExample from "../../../schema/examples/product-snapshot.json";
import reviewExamples from "../../../schema/examples/review.json";
import type { ProductSnapshot, Review } from "./types";

const ajv = new Ajv2020({ schemas: [schema] });
addFormats(ajv);

function validate(ref: string, data: unknown): boolean {
  const validator = ajv.getSchema(`https://verdict.tools/schema/verdict.schema.json${ref}`);
  if (!validator) {
    throw new Error(`no validator found for ${ref}`);
  }
  return validator(data) === true;
}

const [populatedReview, minimalReview] = reviewExamples as [Review, Review];

describe("Review schema", () => {
  it("accepts the shared examples", () => {
    expect(validate("#/$defs/review", populatedReview)).toBe(true);
    expect(validate("#/$defs/review", minimalReview)).toBe(true);
  });

  it("round trips through JSON without losing a field", () => {
    const roundTripped = JSON.parse(JSON.stringify(populatedReview)) as Review;
    expect(roundTripped).toEqual(populatedReview);
    expect(validate("#/$defs/review", roundTripped)).toBe(true);
  });

  it("rejects a review missing a required field", () => {
    const { rating: _rating, ...withoutRating } = populatedReview;
    expect(validate("#/$defs/review", withoutRating)).toBe(false);
  });

  it("rejects an out of range rating", () => {
    const invalid = { ...populatedReview, rating: 6 };
    expect(validate("#/$defs/review", invalid)).toBe(false);
  });
});

describe("ProductSnapshot schema", () => {
  it("accepts the shared example", () => {
    expect(validate("#/$defs/productSnapshot", productSnapshotExample as ProductSnapshot)).toBe(
      true,
    );
  });

  it("round trips through JSON without losing a field", () => {
    const original = productSnapshotExample as ProductSnapshot;
    const roundTripped = JSON.parse(JSON.stringify(original)) as ProductSnapshot;
    expect(roundTripped).toEqual(original);
    expect(validate("#/$defs/productSnapshot", roundTripped)).toBe(true);
  });

  it("rejects a snapshot with a null title", () => {
    const invalid = { ...(productSnapshotExample as ProductSnapshot), title: null };
    expect(validate("#/$defs/productSnapshot", invalid)).toBe(false);
  });
});
