import { describe, expect, it } from "vitest";
import { canonicalJson, buildEnvelope, publishProblems } from "./signRules.mjs";

const FIELD = { strategy: "selector", value: "h1" };

function document(overrides = {}) {
  return { version: 2, site: "amazon", locales: ["com"], fields: { title: FIELD }, ...overrides };
}

describe("publishProblems", () => {
  it("accepts a well formed document on a first publish", () => {
    expect(publishProblems(document(), null)).toEqual([]);
  });

  it("accepts a version above what is already published", () => {
    expect(publishProblems(document({ version: 3 }), 2)).toEqual([]);
  });

  // rulesLoader.ts refuses a remote document older than what it already
  // trusts, so this would look published and never apply.
  it("refuses a version equal to what is already published", () => {
    expect(publishProblems(document({ version: 2 }), 2)[0]).toMatch(/not above the published/);
  });

  it("refuses a version below what is already published", () => {
    expect(publishProblems(document({ version: 1 }), 2)[0]).toMatch(/not above the published/);
  });

  it("refuses something that is not a rules document", () => {
    expect(publishProblems({ version: "two" }, null)[0]).toMatch(/not a rules document/);
    expect(publishProblems(document({ fields: [] }), null)[0]).toMatch(/not a rules document/);
  });

  // an empty document is refused by the validator before this check can
  // speak, which is the same answer by a shorter route.
  it("refuses a document with no fields", () => {
    expect(publishProblems(document({ fields: {} }), null)).toHaveLength(1);
  });

  // the loader is forgiving on arrival so one bad field does not cost a
  // whole document. A publisher has no reason to be: signing a field that
  // will be discarded ships a fix that silently does not apply.
  it("refuses a field the extension would discard, unlike the loader", () => {
    const problems = publishProblems(
      document({ fields: { title: FIELD, reviews: { strategy: "from-the-future" } } }),
      null,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/would discard reviews/);
  });

  it("reports every problem at once rather than the first", () => {
    const problems = publishProblems(
      document({ version: 1, fields: { title: FIELD, a: { strategy: "x" }, b: { strategy: "y" } } }),
      5,
    );
    expect(problems.length).toBeGreaterThan(2);
  });

  it("accepts a composite rule, so a review fallback is publishable", () => {
    const composite = {
      strategy: "composite",
      container: "[data-hook='review']",
      fields: { text: { strategy: "selector", value: "p" } },
    };
    expect(publishProblems(document({ fields: { reviews: composite } }), null)).toEqual([]);
  });
});

// the encoding a signature is computed over. This is the same function
// rulesLoader.ts verifies with, imported rather than copied, because a
// drift between two copies would not fail anything: every published
// document would just stop verifying and every extension would fall back,
// silently.
describe("canonicalJson", () => {
  it("is the loader's own encoding, not a second implementation", async () => {
    const loader = await import("../src/extract/canonicalJson.ts");
    expect(canonicalJson).toBe(loader.canonicalJson);
  });

  it("sorts keys regardless of insertion order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("keeps array order, where order is meaningful", () => {
    expect(canonicalJson({ locales: ["fr", "com"] })).toBe('{"locales":["fr","com"]}');
  });
});

describe("buildEnvelope", () => {
  it("carries the document unchanged beside its signature", () => {
    const rules = document();
    expect(buildEnvelope(rules, "c2ln")).toEqual({ rules, signature: "c2ln" });
  });
});
