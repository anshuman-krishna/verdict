// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { startingRules } from "./bundledRules";
import { extractProductSnapshot, extractReviews } from "./reviewExtraction";
import type { RulesDocument } from "./rules";
import { CATEGORY_SEPARATOR, STANDARD_FIELDS, withStandardFallback } from "./standardRules";
import { resolvePriors, type PriorsDocument } from "../score/priors";

function parse(html: string): ParentNode {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

function block(document_: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(document_)}</script>`;
}

const PAGE = { site: "amazon", locale: "com", productId: "B0BXYZ1234" };
const URL_ = "https://www.amazon.com/dp/B0BXYZ1234";

const RULES = startingRules("amazon");

const PRODUCT_GRAPH = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "BreadcrumbList", name: "Kitchen and Dining" },
    { "@type": "Organization", name: "A Seller Limited" },
    {
      "@type": "Product",
      name: "Stovetop Kettle, 1.7 Litre",
      category: "Kitchen",
      image: ["https://www.amazon.com/images/kettle.jpg"],
      aggregateRating: { "@type": "AggregateRating", ratingValue: 4.6, reviewCount: 8000 },
      review: [
        {
          "@type": "Review",
          reviewBody: "Boils fast.",
          datePublished: "2024-03-02",
          reviewRating: { "@type": "Rating", ratingValue: 5 },
          author: { "@type": "Person", name: "ada", url: "https://www.amazon.com/gp/profile/A1" },
        },
        {
          "@type": "Review",
          description: "Handle got hot.",
          dateCreated: "2024-03-09",
          reviewRating: { "@type": "Rating", ratingValue: 2 },
          author: "bo",
        },
      ],
    },
  ],
};

describe("reading a page by the standard alone, SPEC.md section 9 preference 1", () => {
  it("reads the product out of a graph that holds several kinds of node", () => {
    const snapshot = extractProductSnapshot(parse(block(PRODUCT_GRAPH)), RULES, PAGE, URL_);
    expect(snapshot).toEqual({
      title: "Stovetop Kettle, 1.7 Litre",
      category: "Kitchen",
      claimedRating: 4.6,
      reviewCount: 8000,
      site: "amazon",
      locale: "com",
      url: URL_,
      thumbnailUrl: "https://www.amazon.com/images/kettle.jpg",
    });
  });

  it("does not take the breadcrumb or the seller for the product", () => {
    const snapshot = extractProductSnapshot(parse(block(PRODUCT_GRAPH)), RULES, PAGE, URL_);
    expect(snapshot?.title).not.toBe("Kitchen and Dining");
    expect(snapshot?.title).not.toBe("A Seller Limited");
  });

  it("reads the reviews, and leaves the reviewer unnamed when the page names no account", () => {
    expect(extractReviews(parse(block(PRODUCT_GRAPH)), RULES, "com")).toEqual([
      {
        rating: 5,
        text: "Boils fast.",
        date: "2024-03-02",
        verified: null,
        reviewerId: "https://www.amazon.com/gp/profile/A1",
      },
      { rating: 2, text: "Handle got hot.", date: "2024-03-09", verified: null, reviewerId: null },
    ]);
  });

  it("gathers reviews the page split across separate blocks", () => {
    const root = parse(
      block({ "@type": "Product", name: "a kettle" }) +
        block({ "@type": "Review", reviewBody: "one", reviewRating: { ratingValue: 4 } }) +
        block({ "@type": "Review", reviewBody: "two", reviewRating: { ratingValue: 3 } }),
    );
    expect(extractReviews(root, RULES, "com").map((review) => review.text)).toEqual(["one", "two"]);
  });

  it("is not stopped by a block it cannot parse", () => {
    const root = parse(
      `<script type="application/ld+json">{ not json </script>${block(PRODUCT_GRAPH)}`,
    );
    expect(extractProductSnapshot(root, RULES, PAGE, URL_)?.title).toBe("Stovetop Kettle, 1.7 Litre");
  });

  it("reads a rating count the page states as text in the standard's own format", () => {
    const root = parse(
      block({
        "@type": "Product",
        name: "eine Kanne",
        aggregateRating: { "@type": "AggregateRating", ratingValue: "4.6", reviewCount: "1234" },
      }),
    );
    const snapshot = extractProductSnapshot(root, RULES, { ...PAGE, locale: "de" }, URL_);
    expect(snapshot?.claimedRating).toBe(4.6);
    expect(snapshot?.reviewCount).toBe(1234);
  });

  it("falls back to the open graph title when the page carries no structured data", () => {
    const root = parse('<meta property="og:title" content="A Kettle">');
    expect(extractProductSnapshot(root, RULES, PAGE, URL_)?.title).toBe("A Kettle");
  });

  it("reads an image given as one url, a list, or an object", () => {
    const shapes = [
      "https://www.amazon.com/images/a.jpg",
      ["https://www.amazon.com/images/a.jpg"],
      { "@type": "ImageObject", url: "https://www.amazon.com/images/a.jpg" },
    ];
    for (const image of shapes) {
      const root = parse(block({ "@type": "Product", name: "a kettle", image }));
      expect(extractProductSnapshot(root, RULES, PAGE, URL_)?.thumbnailUrl).toBe(
        "https://www.amazon.com/images/a.jpg",
      );
    }
  });

  it("drops a thumbnail pointed anywhere but a storefront we support", () => {
    const root = parse(
      block({ "@type": "Product", name: "a kettle", image: "https://cdn.example.com/a.jpg" }),
    );
    expect(extractProductSnapshot(root, RULES, PAGE, URL_)?.thumbnailUrl).toBeNull();
  });
});

describe("what the standard is allowed to override", () => {
  const own: RulesDocument = {
    version: 4,
    site: "amazon",
    locales: ["com"],
    fields: { title: { strategy: "selector", value: "#productTitle" } },
  };

  it("lets the storefront's own rule run first", () => {
    const merged = withStandardFallback(own);
    const root = parse(`<h1 id="productTitle">From the page</h1>${block(PRODUCT_GRAPH)}`);
    expect(extractProductSnapshot(root, merged, PAGE, URL_)?.title).toBe("From the page");
  });

  it("catches the field when the storefront's own rule finds nothing", () => {
    const merged = withStandardFallback(own);
    expect(extractProductSnapshot(parse(block(PRODUCT_GRAPH)), merged, PAGE, URL_)?.title).toBe(
      "Stovetop Kettle, 1.7 Litre",
    );
  });

  it("adds each standard field once, however many times a document passes through", () => {
    expect(withStandardFallback(withStandardFallback(own))).toEqual(withStandardFallback(own));
  });

  it("leaves the field alone rather than lengthening a chain that is already long", () => {
    const deep = (depth: number): RulesDocument["fields"][string] =>
      depth === 0
        ? { strategy: "selector", value: ".last" }
        : { strategy: "selector", value: `.step${depth}`, fallback: deep(depth - 1) };
    const long: RulesDocument = { ...own, fields: { title: deep(9) } };
    expect(withStandardFallback(long).fields.title).toEqual(long.fields.title);
  });

  it("names a rule for every field the extractor reads", () => {
    expect(Object.keys(STANDARD_FIELDS).sort()).toEqual([
      "category",
      "claimedRating",
      "reviewCount",
      "reviews",
      "thumbnailUrl",
      "title",
    ]);
  });
});

describe("the category trail a page states", () => {
  function categoryOf(document_: unknown): string | null {
    return extractProductSnapshot(parse(block(document_)), RULES, PAGE, URL_)?.category ?? null;
  }

  it("joins a category the standard allows to be a list", () => {
    expect(categoryOf({ "@type": "Product", name: "a kettle", category: ["Kitchen", "Kettles"] }))
      .toBe(`Kitchen${CATEGORY_SEPARATOR}Kettles`);
  });

  it("reads the breadcrumb when the product states no category", () => {
    expect(
      categoryOf({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, item: { name: "Home & Kitchen" } },
              { "@type": "ListItem", position: 2, item: { name: "Kettles" } },
            ],
          },
          { "@type": "Product", name: "a kettle" },
        ],
      }),
    ).toBe("Home & Kitchen > Kettles");
  });

  it("reads the breadcrumb written with the name on the list item itself", () => {
    expect(
      categoryOf({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Electronics" },
              { "@type": "ListItem", position: 2, name: "Headphones" },
            ],
          },
          { "@type": "Product", name: "some headphones" },
        ],
      }),
    ).toBe("Electronics > Headphones");
  });

  it("reads a breadcrumb marked up in the page itself", () => {
    const root = parse(
      `<div itemtype="https://schema.org/BreadcrumbList">
         <span itemprop="name">Books</span><span itemprop="name">Fiction</span>
       </div>${block({ "@type": "Product", name: "a paperback" })}`,
    );
    expect(extractProductSnapshot(root, RULES, PAGE, URL_)?.category).toBe("Books > Fiction");
  });

  // the point of reading the trail at all, SPEC.md 5.1
  it("reaches the prior for the narrowest part of the trail that has one", () => {
    const priors: PriorsDocument = {
      default: { organicPrior: [0.2, 0.2, 0.2, 0.2, 0.2], injectionKernel: [0, 0, 0, 0.35, 0.65] },
      aliases: {},
      categories: { kettles: { organicPrior: [0.05, 0.05, 0.1, 0.3, 0.5] } },
    };
    const category = categoryOf({
      "@type": "Product",
      name: "a kettle",
      category: ["Home & Kitchen", "Kettles"],
    });
    expect(resolvePriors(category, priors).key).toBe("kettles");
  });
});
