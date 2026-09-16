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
    for (const path of ["$.a[", "$[bare]", "$['unterminated", "$.a[?(@.b)", "$.a[?(@.b>1)]"]) {
      expect(parseJsonPath(path)).toBeNull();
      expect(queryJsonPath({ reviews: [1], a: { b: 2 } }, path)).toEqual([]);
    }
  });

  it("does not let a broken path look like a match and stop the fallback chain", () => {
    const doc = { reviewsData: { reviews: [{ rating: 5 }] } };
    expect(queryJsonPath(doc, "$.reviews[?(@.rating")).toHaveLength(0);
    expect(queryJsonPath(doc, "$..reviews")).toEqual([[{ rating: 5 }]]);
  });

  it("reads an empty path as the document itself, which is what $ means", () => {
    expect(parseJsonPath("$")).toEqual([]);
    expect(queryJsonPath({ a: 1 }, "$")).toEqual([{ a: 1 }]);
  });
});

describe("reading a json-ld document, SPEC.md section 9 preference 1", () => {
  const person = { "@type": "Person", name: "ada" };
  const kind = { "@type": "Review", reviewBody: "good", reviewRating: { ratingValue: 5 }, author: person };
  const harsh = { "@type": "Review", reviewBody: "bad", reviewRating: { ratingValue: 1 }, author: "bo" };
  const product = {
    "@type": ["Product", "Thing"],
    name: "a kettle",
    aggregateRating: { "@type": "AggregateRating", ratingValue: 4.6, reviewCount: 8000 },
    review: [kind, harsh],
  };
  const graph = {
    "@context": "https://schema.org",
    "@graph": [{ "@type": "BreadcrumbList", name: "breadcrumbs" }, product],
  };

  it("finds a node by type wherever the page chose to put it", () => {
    expect(queryJsonPath(graph, "$..[?(@['@type']=='Product')].name")).toEqual(["a kettle"]);
  });

  it("matches a type written as a list, which json-ld allows", () => {
    expect(queryJsonPath({ "@type": ["Thing", "Product"] }, "$..[?(@.@type=='Product')]")).toEqual([
      { "@type": ["Thing", "Product"] },
    ]);
  });

  it("collects every review in the document", () => {
    expect(queryJsonPath(graph, "$..[?(@.@type=='Review')]")).toEqual([kind, harsh]);
  });

  it("descends to a nested key without being told the shape", () => {
    expect(queryJsonPath(graph, "$..aggregateRating.ratingValue")).toEqual([4.6]);
  });

  it("reports a node once however many routes reach it", () => {
    expect(queryJsonPath({ a: product, b: product }, "$..[?(@.@type=='Product')]")).toEqual([product]);
  });

  it("filters on a key being present at all", () => {
    expect(queryJsonPath(graph, "$..[?(@.reviewBody)]")).toEqual([kind, harsh]);
  });

  it("filters on a number", () => {
    expect(queryJsonPath(graph, "$..[?(@.ratingValue==5)]")).toEqual([kind.reviewRating]);
  });

  it("reads a not equal predicate, and a missing key is not equal to anything", () => {
    expect(queryJsonPath({ items: [{ a: 1 }, { a: 2 }, { b: 3 }] }, "$.items[?(@.a!=1)]")).toEqual([
      { a: 2 },
      { b: 3 },
    ]);
  });

  it("keeps a descent that matches nothing empty", () => {
    expect(queryJsonPath(graph, "$..[?(@.@type=='Recipe')].name")).toEqual([]);
  });

  it("refuses a predicate that would compute rather than compare", () => {
    expect(parseJsonPath("$..[?(@.price > 3)]")).toBeNull();
    expect(parseJsonPath("$..[?(@.name.length)]")).toBeNull();
  });

  it("survives a document that points at itself", () => {
    const loop: Record<string, unknown> = { name: "root" };
    loop.self = loop;
    expect(queryJsonPath(loop, "$..name")).toEqual(["root"]);
  });
});

describe("a document with as many nodes as a real listing", () => {
  const reviews = Array.from({ length: 4000 }, (_unused, index) => ({
    "@type": "Review",
    reviewBody: `review number ${index}`,
    reviewRating: { "@type": "Rating", ratingValue: (index % 5) + 1 },
    author: { "@type": "Person", name: `reviewer ${index}` },
  }));
  const graph = { "@graph": [{ "@type": "Product", name: "a kettle", review: reviews }] };

  it("finds every review rather than stopping partway down", () => {
    expect(queryJsonPath(graph, "$..[?(@.@type=='Review')]")).toHaveLength(4000);
  });

  it("stays quick enough to run inside an extraction", () => {
    const started = Date.now();
    queryJsonPath(graph, "$..[?(@.@type=='Review')]");
    expect(Date.now() - started).toBeLessThan(500);
  });
});
