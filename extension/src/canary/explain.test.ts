// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { startingRules } from "../extract/bundledRules";
import type { RulesDocument } from "../extract/rules";
import { explainExtraction, formatExplanation } from "./explain";

function parse(html: string): ParentNode {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

const URL_ = "https://www.amazon.com/dp/B0BXYZ1234";

const PAGE = parse(`
  <script type="application/ld+json">
    {
      "@type": "Product",
      "name": "Stovetop Kettle",
      "aggregateRating": { "@type": "AggregateRating", "ratingValue": 4.6, "reviewCount": 8000 },
      "review": [
        {
          "@type": "Review",
          "reviewBody": "Boils fast.",
          "datePublished": "2024-03-02",
          "reviewRating": { "ratingValue": 5 }
        }
      ]
    }
  </script>
`);

describe("explaining what read a page", () => {
  it("names every field the rules cover, in the order the rules name them", () => {
    const explanation = explainExtraction(PAGE, URL_, startingRules("amazon"));
    expect(explanation.fields.map((field) => field.field)).toEqual(
      Object.keys(startingRules("amazon").fields),
    );
  });

  it("reports the value each field ended up with", () => {
    const explanation = explainExtraction(PAGE, URL_, startingRules("amazon"));
    const byField = new Map(explanation.fields.map((field) => [field.field, field.value]));
    expect(byField.get("title")).toBe("Stovetop Kettle");
    expect(byField.get("claimedRating")).toBe(4.6);
    expect(byField.get("reviews")).toBe(1);
    expect(byField.get("category")).toBeNull();
  });

  it("shows the whole chain, including the steps that matched nothing", () => {
    const rules: RulesDocument = {
      version: 2,
      site: "amazon",
      locales: ["com"],
      fields: {
        title: {
          strategy: "selector",
          value: "#productTitle",
          fallback: { strategy: "embedded-json", path: "$..[?(@.@type=='Product')].name" },
        },
      },
    };
    const steps = explainExtraction(PAGE, URL_, rules).fields[0]?.steps ?? [];
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ strategy: "selector", matched: 0 });
    expect(steps[1]).toMatchObject({ strategy: "embedded-json", matched: 1 });
  });

  it("says so plainly when this build has no rule at all", () => {
    const rules: RulesDocument = { version: 0, site: "amazon", locales: ["com"], fields: {} };
    const text = formatExplanation(explainExtraction(PAGE, URL_, rules));
    expect(text).toContain("no rule for any field");
  });

  it("prints the field, the value, the strategy and what it matched", () => {
    const text = formatExplanation(explainExtraction(PAGE, URL_, startingRules("amazon")));
    expect(text).toContain("amazon com, rules version 0");
    expect(text).toContain('title: "Stovetop Kettle"');
    expect(text).toContain("1 match");
    expect(text).toContain("json-records");
    expect(text).toContain("1 reviews read");
    expect(text).toContain("5 stars, 2024-03-02, verification unknown");
  });

  it("names a page it could not place rather than pretending it read one", () => {
    const explanation = explainExtraction(PAGE, "https://example.com/thing", startingRules("amazon"));
    expect(explanation.site).toBeNull();
    expect(formatExplanation(explanation)).toContain("no supported site");
  });
});
