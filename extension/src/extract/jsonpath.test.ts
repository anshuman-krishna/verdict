import { describe, expect, it } from "vitest";
import { queryJsonPath } from "./jsonpath";

describe("queryJsonPath", () => {
  const data = {
    reviewsData: {
      reviews: [{ rating: 5 }, { rating: 3 }, { rating: 1 }],
    },
    title: "a product",
  };

  it("resolves a single key path to a one element array", () => {
    expect(queryJsonPath(data, "$.title")).toEqual(["a product"]);
  });

  it("resolves a nested key path", () => {
    expect(queryJsonPath(data, "$.reviewsData.reviews")).toEqual([data.reviewsData.reviews]);
  });

  it("resolves a wildcard into every array element", () => {
    expect(queryJsonPath(data, "$.reviewsData.reviews[*]")).toEqual(data.reviewsData.reviews);
  });

  it("resolves a wildcard followed by a key into each element's field", () => {
    expect(queryJsonPath(data, "$.reviewsData.reviews[*].rating")).toEqual([5, 3, 1]);
  });

  it("resolves a numeric index", () => {
    expect(queryJsonPath(data, "$.reviewsData.reviews[1].rating")).toEqual([3]);
  });

  it("returns an empty array for a key that does not exist", () => {
    expect(queryJsonPath(data, "$.nothingHere")).toEqual([]);
  });

  it("returns an empty array for an index out of range", () => {
    expect(queryJsonPath(data, "$.reviewsData.reviews[9]")).toEqual([]);
  });

  it("returns an empty array when a wildcard hits a non array", () => {
    expect(queryJsonPath(data, "$.title[*]")).toEqual([]);
  });
});
