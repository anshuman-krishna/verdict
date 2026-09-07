// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { RulesDocument } from "../extract/rules";
import type { FixtureExpectation } from "./expectation";
import { FixtureError, runFixture } from "./harness";

// the html and the expectations below are synthetic and exist to check the
// harness itself, not extraction. Nothing here is a fixture: the corpus in
// extension/fixtures is saved real pages with hand written expectations,
// and this file never touches it.

const RULES: RulesDocument = {
  version: 1,
  site: "amazon",
  locales: ["com", "fr"],
  fields: {
    title: { strategy: "selector", value: "h1" },
    claimedRating: { strategy: "selector", value: ".rating" },
    reviewCount: { strategy: "selector", value: ".count" },
    reviews: { strategy: "embedded-json", path: "$.reviews[*]" },
  },
};

const URL = "https://www.amazon.com/dp/B0ABCDEF12";

function page(html: string): ParentNode {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

function expectation(overrides: Partial<FixtureExpectation> = {}): FixtureExpectation {
  return { url: URL, layout: "modern", reviewCount: 12, claimedRating: 4.6, ...overrides };
}

const GOOD_PAGE = `
  <h1>a product</h1>
  <span class="rating">4.6</span>
  <span class="count">12</span>
  <script type="application/ld+json">
    { "reviews": [{ "rating": 5 }, { "rating": 4 }] }
  </script>
`;

describe("runFixture", () => {
  it("passes a page matching its expectation", () => {
    const result = runFixture("good", page(GOOD_PAGE), expectation(), RULES);
    expect(result.ok).toBe(true);
    expect(result.locale).toBe("com");
    expect(result.site).toBe("amazon");
    expect(result.extractedReviews).toBe(2);
    expect(result.knownFailure).toBeNull();
  });

  it("fails on a wrong value and names the strategy that produced it", () => {
    const result = runFixture("wrong", page(GOOD_PAGE), expectation({ claimedRating: 3.1 }), RULES);
    expect(result.ok).toBe(false);
    const check = result.checks.find((entry) => entry.field === "claimedRating");
    expect(check?.actual).toBe(4.6);
    expect(check?.strategies).toEqual([
      { strategy: "selector", depth: 0, target: ".rating", matched: 1 },
    ]);
  });

  // PLAN.md week 1 task 6's verify line: a broken selector has to surface
  // as a failure, never as a silent empty result.
  it("fails loudly when a selector matches nothing", () => {
    const result = runFixture("broken", page(`<h1>a product</h1>`), expectation(), RULES);
    expect(result.ok).toBe(false);
    const check = result.checks.find((entry) => entry.field === "claimedRating");
    expect(check?.actual).toBeNull();
    expect(check?.strategies).toEqual([
      { strategy: "selector", depth: 0, target: ".rating", matched: 0 },
    ]);
  });

  it("fails the whole fixture when the title is not found", () => {
    const result = runFixture("untitled", page(`<span class="rating">4.6</span>`), expectation(), RULES);
    expect(result.ok).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]?.field).toBe("title");
  });

  it("reports an empty trace when the rules document has no rule for the field", () => {
    const withoutRating: RulesDocument = {
      ...RULES,
      fields: { title: RULES.fields.title as RulesDocument["fields"][string] },
    };
    const result = runFixture("norule", page(GOOD_PAGE), expectation(), withoutRating);
    const check = result.checks.find((entry) => entry.field === "claimedRating");
    expect(check?.ok).toBe(false);
    expect(check?.strategies).toEqual([]);
  });

  it("checks the extracted review floor only when the expectation sets one", () => {
    const without = runFixture("floorless", page(GOOD_PAGE), expectation(), RULES);
    expect(without.checks.some((entry) => entry.field === "reviews")).toBe(false);

    const under = runFixture(
      "short",
      page(GOOD_PAGE),
      expectation({ minimumExtractedReviews: 8 }),
      RULES,
    );
    expect(under.ok).toBe(false);
    expect(under.checks.find((entry) => entry.field === "reviews")?.actual).toBe(2);
  });

  it("checks title and category only when the expectation carries them", () => {
    const result = runFixture(
      "titled",
      page(GOOD_PAGE),
      expectation({ title: "a different product" }),
      RULES,
    );
    expect(result.ok).toBe(false);
    expect(result.checks.find((entry) => entry.field === "title")?.actual).toBe("a product");
  });

  it("treats a null expectation as a real claim about the page", () => {
    const stated = runFixture(
      "nulls",
      page(`<h1>a product</h1>`),
      expectation({ reviewCount: null, claimedRating: null }),
      RULES,
    );
    expect(stated.ok).toBe(true);
  });

  it("carries a documented reason through to the result", () => {
    const result = runFixture(
      "known",
      page(`<h1>a product</h1>`),
      expectation({ knownFailure: "legacy pagination" }),
      RULES,
    );
    expect(result.ok).toBe(false);
    expect(result.knownFailure).toBe("legacy pagination");
  });

  it("refuses a url it cannot place, rather than guessing a locale", () => {
    expect(() =>
      runFixture("elsewhere", page(GOOD_PAGE), expectation({ url: "https://example.com/thing" }), RULES),
    ).toThrow(FixtureError);
  });
});
