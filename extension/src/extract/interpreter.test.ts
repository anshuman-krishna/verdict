// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { resolveField } from "./interpreter";
import type { FieldRule } from "./rules";

function parse(html: string): ParentNode {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("resolveField, embedded-json strategy", () => {
  it("resolves a wildcard path out of a json-ld script", () => {
    const root = parse(`
      <script type="application/ld+json">
        { "reviewsData": { "reviews": [{ "rating": 5 }, { "rating": 4 }] } }
      </script>
    `);
    const rule: FieldRule = { strategy: "embedded-json", path: "$.reviewsData.reviews[*]" };
    expect(resolveField(root, rule)).toEqual([{ rating: 5 }, { rating: 4 }]);
  });

  it("skips a script with malformed json and tries the next one", () => {
    const root = parse(`
      <script type="application/ld+json">{ not valid json </script>
      <script type="application/ld+json">{ "title": "a product" }</script>
    `);
    const rule: FieldRule = { strategy: "embedded-json", path: "$.title" };
    expect(resolveField(root, rule)).toEqual(["a product"]);
  });

  it("respects a custom script selector", () => {
    const root = parse(`
      <script id="wrong-one">{ "title": "not this one" }</script>
      <script id="reviews-data">{ "title": "the right one" }</script>
    `);
    const rule: FieldRule = {
      strategy: "embedded-json",
      path: "$.title",
      scriptSelector: "#reviews-data",
    };
    expect(resolveField(root, rule)).toEqual(["the right one"]);
  });

  it("falls back to a selector strategy when no script matches the path", () => {
    const root = parse(`
      <script type="application/ld+json">{ "somethingElse": true }</script>
      <div data-hook="review">first review</div>
      <div data-hook="review">second review</div>
    `);
    const rule: FieldRule = {
      strategy: "embedded-json",
      path: "$.reviewsData.reviews[*]",
      fallback: { strategy: "selector", value: "[data-hook='review']" },
    };
    expect(resolveField(root, rule)).toEqual(["first review", "second review"]);
  });
});

describe("resolveField, selector strategy", () => {
  it("resolves matching elements to their trimmed text", () => {
    const root = parse(`<div class="rating">  4.6  </div>`);
    const rule: FieldRule = { strategy: "selector", value: ".rating" };
    expect(resolveField(root, rule)).toEqual(["4.6"]);
  });

  it("resolves an attribute instead of text when configured", () => {
    const root = parse(`<div class="review" data-review-id="r-1">text</div>`);
    const rule: FieldRule = { strategy: "selector", value: ".review", attribute: "data-review-id" };
    expect(resolveField(root, rule)).toEqual(["r-1"]);
  });

  it("falls through a multi level chain to the strategy that finally matches", () => {
    const root = parse(`<span class="last-resort">42</span>`);
    const rule: FieldRule = {
      strategy: "selector",
      value: ".first-choice",
      fallback: {
        strategy: "selector",
        value: ".second-choice",
        fallback: { strategy: "selector", value: ".last-resort" },
      },
    };
    expect(resolveField(root, rule)).toEqual(["42"]);
  });

  it("resolves to an empty array when the whole chain fails, never throwing", () => {
    const root = parse(`<div>nothing usable here</div>`);
    const rule: FieldRule = {
      strategy: "selector",
      value: ".missing",
      fallback: { strategy: "selector", value: ".also-missing" },
    };
    expect(resolveField(root, rule)).toEqual([]);
  });

  it("treats an invalid selector as no match rather than throwing", () => {
    const root = parse(`<div>content</div>`);
    const rule: FieldRule = { strategy: "selector", value: "[[[not a selector" };
    expect(resolveField(root, rule)).toEqual([]);
  });
});
