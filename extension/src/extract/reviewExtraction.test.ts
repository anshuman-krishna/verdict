// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { RulesDocument } from "./rules";
import { extractProductSnapshot, extractReviews } from "./reviewExtraction";

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
    expect(extractReviews(root, rules)).toEqual([
      { rating: 5, text: "great", date: "2024-01-01", verified: true, reviewerId: "r1" },
      { rating: 1, text: "bad", date: null, verified: null, reviewerId: null },
    ]);
  });

  it("returns an empty array when the rules document has no reviews field", () => {
    const rules: RulesDocument = { version: 1, site: "amazon", locales: ["com"], fields: {} };
    expect(extractReviews(parse(""), rules)).toEqual([]);
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
    expect(extractReviews(root, rules)).toEqual([]);
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
