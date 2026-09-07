// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { resolveField, resolveFieldTraced } from "./interpreter";
import { extractReviews } from "./reviewExtraction";
import type { FieldRule, RulesDocument } from "./rules";

function parse(html: string): ParentNode {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

const REVIEW_BLOCKS = `
  <div data-hook="review">
    <span data-hook="rating">4.0 out of 5 stars</span>
    <span data-hook="body">a genuine review with real detail</span>
    <span data-hook="date">Reviewed in the United States on January 3, 2026</span>
    <span data-hook="verified">Verified Purchase</span>
    <a class="profile" href="/gp/profile/amzn1.account.AAA">A reviewer</a>
  </div>
  <div data-hook="review">
    <span data-hook="rating">1.0 out of 5 stars</span>
    <span data-hook="body">a second review saying something else</span>
    <span data-hook="date">Reviewed in the United States on January 9, 2026</span>
    <a class="profile" href="/gp/profile/amzn1.account.BBB">Another reviewer</a>
  </div>
`;

const COMPOSITE: FieldRule = {
  strategy: "composite",
  container: "[data-hook='review']",
  fields: {
    rating: { strategy: "selector", value: "[data-hook='rating']" },
    text: { strategy: "selector", value: "[data-hook='body']" },
    date: { strategy: "selector", value: "[data-hook='date']" },
    verified: { strategy: "presence", value: "[data-hook='verified']" },
    reviewerId: { strategy: "selector", value: "a.profile", attribute: "href" },
  },
};

describe("the composite strategy", () => {
  it("yields one record per container", () => {
    expect(resolveField(parse(REVIEW_BLOCKS), COMPOSITE)).toHaveLength(2);
  });

  // the failure a per page selector would produce: every field taking the
  // first match on the page, so every review looks like the first one.
  it("scopes each field to its own container", () => {
    const records = resolveField(parse(REVIEW_BLOCKS), COMPOSITE) as Record<string, unknown>[];
    expect(records[0]?.text).toBe("a genuine review with real detail");
    expect(records[1]?.text).toBe("a second review saying something else");
    expect(records[0]?.reviewerId).toBe("/gp/profile/amzn1.account.AAA");
    expect(records[1]?.reviewerId).toBe("/gp/profile/amzn1.account.BBB");
  });

  it("answers a presence field per container, true and false", () => {
    const records = resolveField(parse(REVIEW_BLOCKS), COMPOSITE) as Record<string, unknown>[];
    expect(records[0]?.verified).toBe(true);
    expect(records[1]?.verified).toBe(false);
  });

  it("omits a field the container does not carry rather than emitting null", () => {
    const records = resolveField(
      parse(`<div data-hook="review"><span data-hook="body">only a body</span></div>`),
      COMPOSITE,
    ) as Record<string, unknown>[];
    expect(records[0]).toEqual({ text: "only a body", verified: false });
  });

  // an empty record is not a review, and counting one would inflate the
  // count SPEC.md section 6's thresholds are measured against.
  it("drops a container that matched no field at all", () => {
    expect(resolveField(parse(`<div data-hook="review"></div>`), COMPOSITE)).toEqual([]);
  });

  it("yields nothing when no container matches, so a fallback can run", () => {
    expect(resolveField(parse(`<div class="other"></div>`), COMPOSITE)).toEqual([]);
  });

  it("survives an invalid container selector rather than throwing", () => {
    expect(resolveField(parse(REVIEW_BLOCKS), { ...COMPOSITE, container: ":::" })).toEqual([]);
  });

  it("survives an invalid field selector, dropping only that field", () => {
    const records = resolveField(parse(REVIEW_BLOCKS), {
      ...COMPOSITE,
      fields: { ...COMPOSITE.fields, text: { strategy: "selector", value: ":::" } },
    }) as Record<string, unknown>[];
    expect(records[0]?.text).toBeUndefined();
    expect(records[0]?.date).toBe("Reviewed in the United States on January 3, 2026");
  });

  it("resolves a field's own fallback chain inside the container", () => {
    const records = resolveField(parse(REVIEW_BLOCKS), {
      ...COMPOSITE,
      fields: {
        text: {
          strategy: "selector",
          value: "[data-hook='legacy-body']",
          fallback: { strategy: "selector", value: "[data-hook='body']" },
        },
      },
    }) as Record<string, unknown>[];
    expect(records[0]?.text).toBe("a genuine review with real detail");
  });
});

describe("the presence strategy", () => {
  it("is true when the selector matches", () => {
    expect(resolveField(parse(`<b class="badge"></b>`), { strategy: "presence", value: ".badge" })).toEqual([true]);
  });

  // false is an answer, so it must not look like a failed match, or a
  // fallback would fire and report someone else's badge.
  it("is false when it does not, rather than falling through", () => {
    const rule: FieldRule = {
      strategy: "presence",
      value: ".badge",
      fallback: { strategy: "selector", value: "p" },
    };
    expect(resolveField(parse(`<p>some text</p>`), rule)).toEqual([false]);
  });

  it("is false for an invalid selector", () => {
    expect(resolveField(parse(`<b></b>`), { strategy: "presence", value: ":::" })).toEqual([false]);
  });
});

describe("tracing the new strategies", () => {
  it("names the container selector and how many records it produced", () => {
    expect(resolveFieldTraced(parse(REVIEW_BLOCKS), COMPOSITE).trace).toEqual([
      { strategy: "composite", depth: 0, target: "[data-hook='review']", matched: 2 },
    ]);
  });

  it("records a composite reached through a fallback chain", () => {
    const rule: FieldRule = {
      strategy: "embedded-json",
      path: "$.reviews[*]",
      fallback: COMPOSITE,
    };
    expect(resolveFieldTraced(parse(REVIEW_BLOCKS), rule).trace).toEqual([
      { strategy: "embedded-json", depth: 0, target: "$.reviews[*]", matched: 0 },
      { strategy: "composite", depth: 1, target: "[data-hook='review']", matched: 2 },
    ]);
  });
});

// SPEC.md section 9's own rules.json example falls back from an embedded
// json path to a selector for the reviews field. Before the composite
// strategy that fallback extracted nothing, so the most important field in
// the document was the one field with no working fallback.
describe("reviews through a fallback chain", () => {
  const RULES: RulesDocument = {
    version: 1,
    site: "amazon",
    locales: ["com"],
    fields: {
      reviews: { strategy: "embedded-json", path: "$.reviewsData.reviews[*]", fallback: COMPOSITE },
    },
  };

  it("uses the embedded json when the page still carries it", () => {
    const root = parse(`
      <script type="application/ld+json">
        { "reviewsData": { "reviews": [{ "rating": 5, "text": "from json" }] } }
      </script>
      ${REVIEW_BLOCKS}
    `);
    const reviews = extractReviews(root, RULES, "com");
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.text).toBe("from json");
  });

  it("falls back to the review blocks when the embedded json is gone", () => {
    const reviews = extractReviews(parse(REVIEW_BLOCKS), RULES, "com");
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toEqual({
      rating: 4,
      text: "a genuine review with real detail",
      date: "2026-01-03",
      verified: true,
      reviewerId: "/gp/profile/amzn1.account.AAA",
    });
    expect(reviews[1]?.verified).toBe(false);
    expect(reviews[1]?.date).toBe("2026-01-09");
  });

  it("normalises the fallback's strings per locale, same as the json path", () => {
    const french = parse(REVIEW_BLOCKS.replace(
      /Reviewed in the United States on January 3, 2026/,
      "Commenté en France le 3 janvier 2026",
    ).replace(/4\.0 out of 5 stars/, "4,0 sur 5"));
    const reviews = extractReviews(french, RULES, "fr");
    expect(reviews[0]?.rating).toBe(4);
    expect(reviews[0]?.date).toBe("2026-01-03");
  });
});
