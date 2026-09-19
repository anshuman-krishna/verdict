// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { RulesDocument } from "./rules";
import { extractProductSnapshot, extractReviews } from "./reviewExtraction";
import { newPageIndex } from "./structuredData";

function parse(html: string): ParentNode {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

const PAGE = { site: "amazon" as const, locale: "com", productId: "B0BXYZ1234" };

describe("extractReviews", () => {
  it("coerces matched json objects into the Review shape", () => {
    const root = parse(`
      <script type="application/ld+json">
        { "reviewsData": { "reviews": [
          { "rating": 5, "text": "great", "date": "2024-01-01", "verified": true, "reviewerId": "r1" },
          { "rating": 1, "text": "bad" }
        ] } }
      </script>
    `);
    const rules: RulesDocument = {
      version: 1,
      site: "amazon",
      locales: ["com"],
      fields: { reviews: { strategy: "embedded-json", path: "$.reviewsData.reviews[*]" } },
    };
    expect(extractReviews(root, rules, "com")).toEqual([
      { rating: 5, text: "great", date: "2024-01-01", verified: true, reviewerId: "r1" },
      { rating: 1, text: "bad", date: null, verified: null, reviewerId: null },
    ]);
  });


  it("records how wide a relative date was, and resolves it against when the page was read", () => {
    const root = parse(`
      <script type="application/ld+json">
        { "reviewsData": { "reviews": [
          { "rating": 5, "text": "great", "date": "2 days ago" },
          { "rating": 4, "text": "fine", "date": "3 months ago" },
          { "rating": 3, "text": "ok", "date": "2024-01-01" }
        ] } }
      </script>
    `);
    const rules: RulesDocument = {
      version: 1,
      site: "amazon",
      locales: ["com"],
      fields: { reviews: { strategy: "embedded-json", path: "$.reviewsData.reviews[*]" } },
    };
    const read = Date.UTC(2026, 2, 18, 11, 0);
    expect(extractReviews(root, rules, "com", newPageIndex(), read)).toEqual([
      {
        rating: 5,
        text: "great",
        date: "2026-03-16",
        datePrecision: "day",
        verified: null,
        reviewerId: null,
      },
      {
        rating: 4,
        text: "fine",
        date: "2025-12-18",
        datePrecision: "month",
        verified: null,
        reviewerId: null,
      },
      // an absolute date is the absent case, so nothing is written on it
      { rating: 3, text: "ok", date: "2024-01-01", verified: null, reviewerId: null },
    ]);
  });

  it("returns an empty array when the rules document has no reviews field", () => {
    const rules: RulesDocument = { version: 1, site: "amazon", locales: ["com"], fields: {} };
    expect(extractReviews(parse(""), rules, "com")).toEqual([]);
  });

  it("drops matches that are not objects, such as a selector fallback's plain strings", () => {
    const root = parse(`<div data-hook="review">some text</div>`);
    const rules: RulesDocument = {
      version: 1,
      site: "amazon",
      locales: ["com"],
      fields: {
        reviews: {
          strategy: "embedded-json",
          path: "$.reviewsData.reviews[*]",
          fallback: { strategy: "selector", value: "[data-hook='review']" },
        },
      },
    };
    expect(extractReviews(root, rules, "com")).toEqual([]);
  });
});

describe("extractProductSnapshot", () => {
  it("builds a snapshot from selector matched fields", () => {
    const root = parse(`
      <span class="title">A very good widget</span>
      <span class="rating">4.6</span>
    `);
    const rules: RulesDocument = {
      version: 1,
      site: "amazon",
      locales: ["com"],
      fields: {
        title: { strategy: "selector", value: ".title" },
        claimedRating: { strategy: "selector", value: ".rating" },
      },
    };
    expect(extractProductSnapshot(root, rules, PAGE, "https://www.amazon.com/dp/B0BXYZ1234")).toEqual({
      title: "A very good widget",
      category: null,
      claimedRating: 4.6,
      reviewCount: null,
      site: "amazon",
      locale: "com",
      url: "https://www.amazon.com/dp/B0BXYZ1234",
      thumbnailUrl: null,
    });
  });

  it("returns null when no title can be found, rather than a blank snapshot", () => {
    const rules: RulesDocument = { version: 1, site: "amazon", locales: ["com"], fields: {} };
    expect(
      extractProductSnapshot(parse(""), rules, PAGE, "https://www.amazon.com/dp/B0BXYZ1234"),
    ).toBeNull();
  });
});

describe("how a rule says its numbers are written", () => {
  function snapshotOf(format: "locale" | "machine" | undefined, locale: string) {
    const root = parse(
      `<script type="application/ld+json">${JSON.stringify({ title: "a product", count: "1.234" })}</script>`,
    );
    const rules: RulesDocument = {
      version: 1,
      site: "amazon",
      locales: [locale],
      fields: {
        title: { strategy: "embedded-json", path: "$.title" },
        reviewCount: { strategy: "embedded-json", format, path: "$.count" },
      },
    };
    return extractProductSnapshot(root, rules, { ...PAGE, locale }, "https://www.amazon.de/dp/B0BXYZ1234");
  }

  it("reads the storefront's own blob as the page writes numbers", () => {
    expect(snapshotOf(undefined, "de")?.reviewCount).toBe(1234);
    expect(snapshotOf("locale", "de")?.reviewCount).toBe(1234);
  });

  it("reads a machine stated number the same way in every locale", () => {
    expect(snapshotOf("machine", "de")?.reviewCount).toBe(1.234);
    expect(snapshotOf("machine", "com")?.reviewCount).toBe(1.234);
  });

  it("takes a number already stated as one, whatever the rule says", () => {
    const root = parse(
      `<script type="application/ld+json">{ "title": "a product", "count": 1234 }</script>`,
    );
    const rules: RulesDocument = {
      version: 1,
      site: "amazon",
      locales: ["de"],
      fields: {
        title: { strategy: "embedded-json", path: "$.title" },
        reviewCount: { strategy: "embedded-json", path: "$.count" },
      },
    };
    expect(
      extractProductSnapshot(root, rules, { ...PAGE, locale: "de" }, "https://www.amazon.de/dp/B0BXYZ1234")
        ?.reviewCount,
    ).toBe(1234);
  });
});

describe("a field spread over several nodes", () => {
  const html = `<nav class="crumbs"><a>Home &amp; Kitchen</a><a>Kettles</a></nav>` +
    `<h1 class="title">a kettle</h1>`;

  function snapshotWith(join?: string) {
    const root = parse(html);
    const rules: RulesDocument = {
      version: 1,
      site: "amazon",
      locales: ["com"],
      fields: {
        title: { strategy: "selector", value: ".title" },
        category: { strategy: "selector", value: ".crumbs a", ...(join === undefined ? {} : { join }) },
      },
    };
    return extractProductSnapshot(root, rules, PAGE, "https://www.amazon.com/dp/B0BXYZ1234");
  }

  it("reads back as the trail it is when the rule says how to join it", () => {
    expect(snapshotWith(" > ")?.category).toBe("Home & Kitchen > Kettles");
  });

  it("takes the first match when the rule says nothing", () => {
    expect(snapshotWith()?.category).toBe("Home & Kitchen");
  });
});
