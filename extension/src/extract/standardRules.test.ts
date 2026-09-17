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

// a storefront that marks its page up rather than embedding a json block is read by
// the same rules, because the vocabulary is the same and only the spelling differs
describe("the standard ruleset on a page with no json-ld at all", () => {
  const MICRODATA_PAGE = `
    <nav itemscope itemtype="https://schema.org/BreadcrumbList">
      <span itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
        <a itemprop="item" href="https://www.amazon.com/home"><span itemprop="name">Home & Kitchen</span></a>
      </span>
      <span itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
        <a itemprop="item" href="https://www.amazon.com/kettles"><span itemprop="name">Kettles</span></a>
      </span>
    </nav>
    <div itemscope itemtype="https://schema.org/Product">
      <h1 itemprop="name">Stovetop Kettle, 1.7 Litre</h1>
      <img itemprop="image" src="https://www.amazon.com/images/kettle.jpg">
      <div itemprop="aggregateRating" itemscope itemtype="https://schema.org/AggregateRating">
        <meta itemprop="ratingValue" content="4.6">
        <meta itemprop="reviewCount" content="8000">
      </div>
      <div itemprop="review" itemscope itemtype="https://schema.org/Review">
        <span itemprop="reviewBody">Boils fast.</span>
        <time itemprop="datePublished" datetime="2024-03-02">2 March 2024</time>
        <div itemprop="reviewRating" itemscope itemtype="https://schema.org/Rating">
          <meta itemprop="ratingValue" content="5">
        </div>
      </div>
      <div itemprop="review" itemscope itemtype="https://schema.org/Review">
        <span itemprop="reviewBody">Handle got warm.</span>
        <time itemprop="datePublished" datetime="2024-03-04">4 March 2024</time>
        <div itemprop="reviewRating" itemscope itemtype="https://schema.org/Rating">
          <meta itemprop="ratingValue" content="3">
        </div>
      </div>
    </div>
  `;

  it("reads the whole product snapshot out of microdata", () => {
    const product = extractProductSnapshot(parse(MICRODATA_PAGE), RULES, PAGE, URL_);
    expect(product).toMatchObject({
      title: "Stovetop Kettle, 1.7 Litre",
      claimedRating: 4.6,
      reviewCount: 8000,
      thumbnailUrl: "https://www.amazon.com/images/kettle.jpg",
    });
  });

  it("reads the breadcrumb trail out of microdata, which is what the prior keys on", () => {
    expect(extractProductSnapshot(parse(MICRODATA_PAGE), RULES, PAGE, URL_)?.category).toBe(
      `Home & Kitchen${CATEGORY_SEPARATOR}Kettles`,
    );
  });

  it("reads the reviews out of microdata, which no selector could have built", () => {
    expect(extractReviews(parse(MICRODATA_PAGE), RULES, "com")).toEqual([
      { rating: 5, text: "Boils fast.", date: "2024-03-02", verified: null, reviewerId: null },
      { rating: 3, text: "Handle got warm.", date: "2024-03-04", verified: null, reviewerId: null },
    ]);
  });

  it("reads a rating written as text rather than as a meta content attribute", () => {
    const root = parse(`
      <div itemscope itemtype="https://schema.org/Product">
        <h1 itemprop="name">a kettle</h1>
        <div itemprop="aggregateRating" itemscope itemtype="https://schema.org/AggregateRating">
          <span itemprop="ratingValue">4.4</span>
          <span itemprop="ratingCount">120</span>
        </div>
      </div>
    `);
    const product = extractProductSnapshot(root, RULES, PAGE, URL_);
    expect(product?.claimedRating).toBe(4.4);
    expect(product?.reviewCount).toBe(120);
  });

  const RDFA_PAGE = `
    <div vocab="https://schema.org/" typeof="Product">
      <h1 property="name">Paperback Novel</h1>
      <span property="category">Books</span>
      <div property="aggregateRating" typeof="AggregateRating">
        <span property="ratingValue" content="4.1">4.1 out of 5</span>
        <span property="reviewCount" content="312">312 reviews</span>
      </div>
      <div property="review" typeof="Review">
        <span property="reviewBody">Read it in a weekend.</span>
        <meta property="datePublished" content="2024-05-11">
        <div property="reviewRating" typeof="Rating">
          <meta property="ratingValue" content="4">
        </div>
      </div>
    </div>
  `;

  it("reads a product marked up in rdfa lite", () => {
    const product = extractProductSnapshot(parse(RDFA_PAGE), RULES, PAGE, URL_);
    expect(product).toMatchObject({
      title: "Paperback Novel",
      category: "Books",
      claimedRating: 4.1,
      reviewCount: 312,
    });
  });

  it("reads the reviews out of rdfa lite", () => {
    expect(extractReviews(parse(RDFA_PAGE), RULES, "com")).toEqual([
      {
        rating: 4,
        text: "Read it in a weekend.",
        date: "2024-05-11",
        verified: null,
        reviewerId: null,
      },
    ]);
  });

  it("prefers a json block to the markup when the page carries both", () => {
    const root = parse(
      `${block({ "@type": "Product", name: "what the block says" })}
       <div itemscope itemtype="https://schema.org/Product">
         <h1 itemprop="name">what the markup says</h1>
       </div>`,
    );
    expect(extractProductSnapshot(root, RULES, PAGE, URL_)?.title).toBe("what the block says");
  });
});

// the page is read once per extraction and not once for the life of the tab, because a
// storefront that navigates without a page load hands the same document a new listing
describe("a page that changed between two extractions", () => {
  it("is read again rather than answered from the last reading", () => {
    const root = parse(`
      <div itemscope itemtype="https://schema.org/Product">
        <h1 itemprop="name">the first listing</h1>
      </div>
    `);
    expect(extractProductSnapshot(root, RULES, PAGE, URL_)?.title).toBe("the first listing");

    const heading = (root as Element).querySelector("h1") as Element;
    heading.textContent = "the listing after navigating";
    expect(extractProductSnapshot(root, RULES, PAGE, URL_)?.title).toBe(
      "the listing after navigating",
    );
  });
});
