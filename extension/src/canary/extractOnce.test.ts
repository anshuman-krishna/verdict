// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { RulesDocument } from "../extract/rules";
import { extractFull, extractOnce } from "./extractOnce";

const RULES: RulesDocument = {
  version: 41,
  site: "amazon",
  locales: ["com", "fr"],
  fields: {
    title: { strategy: "selector", value: "h1" },
    reviews: { strategy: "embedded-json", path: "$.reviews[*]" },
  },
};

function page(html: string): ParentNode {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

const GOOD = `
  <h1>a product</h1>
  <script type="application/ld+json">{ "reviews": [{ "rating": 5 }, { "rating": 4 }] }</script>
`;

describe("extractOnce", () => {
  it("reports the review count, the title, and the rules version that produced them", () => {
    expect(extractOnce(page(GOOD), "https://www.amazon.fr/dp/B0ABCDEF12", RULES)).toEqual({
      url: "https://www.amazon.fr/dp/B0ABCDEF12",
      site: "amazon",
      locale: "fr",
      rulesVersion: 41,
      reviewCount: 2,
      title: "a product",
    });
  });

  it("reports zero reviews rather than failing when the rules match nothing", () => {
    const result = extractOnce(page("<div>a page that changed</div>"), "https://www.amazon.com/dp/B0ABCDEF12", RULES);
    expect(result.reviewCount).toBe(0);
    expect(result.title).toBeNull();
  });

  it("reports a title with no reviews, which is a different failure from no page", () => {
    const result = extractOnce(page("<h1>a product</h1>"), "https://www.amazon.com/dp/B0ABCDEF12", RULES);
    expect(result.title).toBe("a product");
    expect(result.reviewCount).toBe(0);
  });

  it("places the site and locale from the url", () => {
    const result = extractOnce(page(GOOD), "https://www.amazon.com/dp/B0ABCDEF12", RULES);
    expect(result.locale).toBe("com");
  });

  it("reports a url it cannot place as no site and no reviews", () => {
    expect(extractOnce(page(GOOD), "https://example.com/thing", RULES)).toEqual({
      url: "https://example.com/thing",
      site: null,
      locale: null,
      rulesVersion: 41,
      reviewCount: 0,
      title: null,
    });
  });

  it("carries the rules version through even when nothing matched", () => {
    expect(extractOnce(page("<div></div>"), "https://www.amazon.com/dp/B0ABCDEF12", RULES).rulesVersion).toBe(41);
  });
});

describe("extractFull", () => {
  it("carries the reviews and the product snapshot the corpus builder needs", () => {
    const result = extractFull(page(GOOD), "https://www.amazon.fr/dp/B0ABCDEF12", RULES);
    expect(result.reviews).toHaveLength(2);
    expect(result.reviews[0]?.rating).toBe(5);
    expect(result.product?.title).toBe("a product");
  });

  it("agrees with extractOnce on every field they share", () => {
    const url = "https://www.amazon.com/dp/B0ABCDEF12";
    const { product: _product, reviews: _reviews, ...shared } = extractFull(page(GOOD), url, RULES);
    expect(shared).toEqual(extractOnce(page(GOOD), url, RULES));
  });

  it("returns no reviews rather than throwing on a url it cannot place", () => {
    const result = extractFull(page(GOOD), "https://example.com/thing", RULES);
    expect(result.reviews).toEqual([]);
    expect(result.product).toBeNull();
  });
});
