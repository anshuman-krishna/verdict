// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { chainLength, isWorse, readFields, readingFor, worstHealth } from "./health";
import { resolveFieldTraced } from "./interpreter";
import type { FieldRule, RulesDocument } from "./rules";

function parse(html: string): ParentNode {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

function reading(root: ParentNode, rule: FieldRule) {
  return readingFor("title", rule, resolveFieldTraced(root, rule).trace);
}

const CHAIN: FieldRule = {
  strategy: "embedded-json",
  path: "$.title",
  fallback: {
    strategy: "selector",
    value: ".title",
    fallback: { strategy: "selector", value: ".legacy-title" },
  },
};

describe("chainLength", () => {
  it("counts a rule with no fallback as one", () => {
    expect(chainLength({ strategy: "selector", value: ".title" })).toBe(1);
  });

  it("counts every rule a field can fall through to", () => {
    expect(chainLength(CHAIN)).toBe(3);
  });
});

describe("readingFor", () => {
  it("calls the first rule answering primary, which is the healthy case", () => {
    const root = parse('<script type="application/ld+json">{"title":"a kettle"}</script>');
    expect(reading(root, CHAIN)).toEqual({
      field: "title",
      health: "primary",
      depth: 0,
      tiers: 3,
      strategy: "embedded-json",
      source: null,
    });
  });

  it("calls a middle rule a fallback, which is worth watching and not worth alerting", () => {
    expect(reading(parse('<span class="title">a kettle</span>'), CHAIN)).toMatchObject({
      health: "fallback",
      depth: 1,
      tiers: 3,
    });
  });

  // the warning that arrives before the page reads nothing at all
  it("calls the end of the chain a last resort", () => {
    expect(reading(parse('<span class="legacy-title">a kettle</span>'), CHAIN)).toMatchObject({
      health: "last-resort",
      depth: 2,
    });
  });

  it("calls a chain that answered nowhere missing, at no depth", () => {
    expect(reading(parse("<div></div>"), CHAIN)).toEqual({
      field: "title",
      health: "missing",
      depth: -1,
      tiers: 3,
      strategy: null,
      source: null,
    });
  });

  it("calls a single rule that answered primary rather than a last resort", () => {
    const rule: FieldRule = { strategy: "selector", value: ".title" };
    expect(reading(parse('<span class="title">a kettle</span>'), rule)).toMatchObject({
      health: "primary",
      tiers: 1,
    });
  });

  it("names the serialisation the answer came from", () => {
    const rule: FieldRule = {
      strategy: "embedded-json",
      path: "$..[?(@.@type=='Product')].name",
      fallback: {
        strategy: "embedded-json",
        source: "microdata",
        path: "$..[?(@.@type=='Product')].name",
      },
    };
    const root = parse(`
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">a kettle</span>
      </div>
    `);
    expect(reading(root, rule)).toMatchObject({ health: "last-resort", source: "microdata" });
  });
});

describe("isWorse", () => {
  it("ranks a chain read further down as worse", () => {
    expect(isWorse("last-resort", "primary")).toBe(true);
    expect(isWorse("missing", "last-resort")).toBe(true);
  });

  it("does not call a recovery a decline", () => {
    expect(isWorse("primary", "last-resort")).toBe(false);
    expect(isWorse("fallback", "fallback")).toBe(false);
  });
});

describe("readFields", () => {
  const RULES: RulesDocument = {
    version: 1,
    site: "amazon",
    locales: ["com"],
    fields: {
      title: { strategy: "selector", value: ".product-title" },
      claimedRating: CHAIN,
    },
  };

  it("reports one reading per field the rules describe", () => {
    const readings = readFields(parse('<span class="product-title">a kettle</span>'), RULES);
    expect(readings.map((entry) => entry.field)).toEqual(["title", "claimedRating"]);
    expect(readings.map((entry) => entry.health)).toEqual(["primary", "missing"]);
  });

  it("summarises a page by the field that read worst", () => {
    expect(
      worstHealth(readFields(parse('<span class="product-title">a kettle</span>'), RULES)),
    ).toBe("missing");
  });

  it("calls a page every rule answered on primary", () => {
    const root = parse(
      '<span class="product-title">a kettle</span>' +
        '<script type="application/ld+json">{"title":"a kettle"}</script>',
    );
    expect(worstHealth(readFields(root, RULES))).toBe("primary");
  });
});
