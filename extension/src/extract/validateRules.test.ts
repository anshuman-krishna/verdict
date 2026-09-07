import { describe, expect, it } from "vitest";
import { sanitiseRulesDocument } from "./validateRules";

const SELECTOR = { strategy: "selector", value: "h1" };

function document(fields: Record<string, unknown> = { title: SELECTOR }): Record<string, unknown> {
  return { version: 41, site: "amazon", locales: ["com", "fr"], fields };
}

describe("sanitiseRulesDocument", () => {
  it("accepts a well formed document unchanged", () => {
    const result = sanitiseRulesDocument(document());
    expect(result?.rules.version).toBe(41);
    expect(result?.rules.fields.title).toEqual(SELECTOR);
    expect(result?.problems).toEqual([]);
  });

  it.each([
    ["not an object", "a string"],
    ["an array", []],
    ["null", null],
  ])("refuses %s", (_label, value) => {
    expect(sanitiseRulesDocument(value)).toBeNull();
  });

  it.each([
    ["a missing version", { ...document(), version: undefined }],
    ["a fractional version", { ...document(), version: 1.5 }],
    ["a negative version", { ...document(), version: -1 }],
    ["an empty site", { ...document(), site: "" }],
    ["locales that are not an array", { ...document(), locales: "com" }],
    ["a non string locale", { ...document(), locales: ["com", 7] }],
    ["fields that are not an object", { ...document(), fields: [] }],
  ])("refuses %s", (_label, value) => {
    expect(sanitiseRulesDocument(value)).toBeNull();
  });

  // a document that extracts nothing is an outage delivered over the
  // network, and the bundled rules are strictly better than that.
  it("refuses a document with no usable field left", () => {
    expect(sanitiseRulesDocument(document({}))).toBeNull();
    expect(sanitiseRulesDocument(document({ title: { strategy: "telepathy" } }))).toBeNull();
  });

  // a rules version using a strategy this build predates should still
  // deliver every other fix in it, so one unusable field is dropped rather
  // than costing the whole document.
  it("drops an unusable field and keeps the rest, saying which", () => {
    const result = sanitiseRulesDocument(
      document({ title: SELECTOR, reviews: { strategy: "from-the-future" } }),
    );
    expect(Object.keys(result?.rules.fields ?? {})).toEqual(["title"]);
    expect(result?.problems).toEqual(['reviews: unknown strategy "from-the-future"']);
  });

  it.each([
    ["a selector with no value", { strategy: "selector" }],
    ["a selector with an empty value", { strategy: "selector", value: "" }],
    ["a selector with a non string attribute", { strategy: "selector", value: "h1", attribute: 7 }],
    ["an embedded json rule with no path", { strategy: "embedded-json" }],
    ["a presence rule with no value", { strategy: "presence" }],
    ["a rule that is not an object", "h1"],
  ])("drops %s", (_label, rule) => {
    expect(sanitiseRulesDocument(document({ title: SELECTOR, bad: rule }))?.problems).toHaveLength(1);
  });

  it("accepts the optional keys when they are strings", () => {
    const result = sanitiseRulesDocument(
      document({
        title: { strategy: "embedded-json", path: "$.title", scriptSelector: "script#data" },
        thumbnailUrl: { strategy: "selector", value: "img", attribute: "src" },
      }),
    );
    expect(result?.problems).toEqual([]);
  });

  describe("composite rules", () => {
    const composite = {
      strategy: "composite",
      container: "[data-hook='review']",
      fields: { text: { strategy: "selector", value: "p" } },
    };

    it("accepts a well formed composite", () => {
      expect(sanitiseRulesDocument(document({ reviews: composite }))?.problems).toEqual([]);
    });

    it("drops a composite with no container", () => {
      const result = sanitiseRulesDocument(
        document({ title: SELECTOR, reviews: { ...composite, container: undefined } }),
      );
      expect(result?.problems[0]).toMatch(/container/);
    });

    // every container would produce an empty record, which the interpreter
    // then drops, so this is an extraction of zero dressed as a rule.
    it("drops a composite with no fields", () => {
      const result = sanitiseRulesDocument(
        document({ title: SELECTOR, reviews: { ...composite, fields: {} } }),
      );
      expect(result?.problems[0]).toMatch(/fields is empty/);
    });

    it("drops a composite whose own field is malformed, naming the field", () => {
      const result = sanitiseRulesDocument(
        document({
          title: SELECTOR,
          reviews: { ...composite, fields: { text: { strategy: "selector" } } },
        }),
      );
      expect(result?.problems[0]).toMatch(/field text value is missing/);
    });
  });

  describe("fallback chains", () => {
    it("validates a fallback as a rule in its own right", () => {
      const result = sanitiseRulesDocument(
        document({ title: SELECTOR, reviews: { ...SELECTOR, fallback: { strategy: "nonsense" } } }),
      );
      expect(result?.problems[0]).toMatch(/fallback unknown strategy/);
    });

    it("accepts a chain several deep", () => {
      let rule: unknown = SELECTOR;
      for (let index = 0; index < 5; index += 1) {
        rule = { ...SELECTOR, fallback: rule };
      }
      expect(sanitiseRulesDocument(document({ title: rule }))?.problems).toEqual([]);
    });

    // a cap so validation cannot be made to walk as far as the file is
    // long by a document built to do exactly that.
    it("drops a chain deeper than the cap", () => {
      let rule: unknown = SELECTOR;
      for (let index = 0; index < 40; index += 1) {
        rule = { ...SELECTOR, fallback: rule };
      }
      const result = sanitiseRulesDocument(document({ title: SELECTOR, deep: rule }));
      expect(result?.problems[0]).toMatch(/deeper than/);
    });
  });
});
