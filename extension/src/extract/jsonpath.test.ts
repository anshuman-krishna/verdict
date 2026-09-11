import { describe, expect, it } from "vitest";
import { parseJsonPath, queryJsonPath } from "./jsonpath";

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

  it("resolves a json-ld key carrying an at sign", () => {
    const jsonLd = { "@type": "Product", "@context": "https://schema.org" };
    expect(queryJsonPath(jsonLd, "$.@type")).toEqual(["Product"]);
  });

  it("resolves a key carrying a hyphen", () => {
    expect(queryJsonPath({ "review-count": 12 }, "$.review-count")).toEqual([12]);
  });

  it("resolves a bracket quoted key, single or double quoted", () => {
    const jsonLd = { "@type": "Product", "odd key": 1 };
    expect(queryJsonPath(jsonLd, "$['@type']")).toEqual(["Product"]);
    expect(queryJsonPath(jsonLd, `$["@type"]`)).toEqual(["Product"]);
    expect(queryJsonPath(jsonLd, "$['odd key']")).toEqual([1]);
  });

  it("walks into a bracket quoted key and on through the rest of the path", () => {
    const jsonLd = { "@graph": { reviews: [{ rating: 4 }] } };
    expect(queryJsonPath(jsonLd, "$['@graph'].reviews[*].rating")).toEqual([4]);
  });

  it("reads nothing from the prototype chain, only own properties", () => {
    expect(queryJsonPath(data, "$.constructor")).toEqual([]);
    expect(queryJsonPath(data, "$.toString")).toEqual([]);
    expect(queryJsonPath(data, "$.__proto__")).toEqual([]);
  });

  it("still reads an own property that shadows a prototype name", () => {
    expect(queryJsonPath({ constructor: "mine" }, "$.constructor")).toEqual(["mine"]);
  });
});

describe("a path the parser cannot read", () => {
  it("matches nothing rather than reporting the whole document", () => {
    for (const path of ["$..reviews", "$.a[", "$[bare]", "$.a..b", "$['unterminated"]) {
      expect(parseJsonPath(path)).toBeNull();
      expect(queryJsonPath({ reviews: [1], a: { b: 2 } }, path)).toEqual([]);
    }
  });

  it("does not let a broken path look like a match and stop the fallback chain", () => {
    const doc = { reviewsData: { reviews: [{ rating: 5 }] } };
    expect(queryJsonPath(doc, "$..reviews")).toHaveLength(0);
  });

  it("reads an empty path as the document itself, which is what $ means", () => {
    expect(parseJsonPath("$")).toEqual([]);
    expect(queryJsonPath({ a: 1 }, "$")).toEqual([{ a: 1 }]);
  });
});
