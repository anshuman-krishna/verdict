import { describe, expect, it } from "vitest";
import { SITES } from "./sites";
import document from "./rules/amazon.json";
import { BUNDLED_RULES, bundledRulesFor, emptyRules } from "./bundledRules";

import type { RulesDocument } from "./rules";

const BUNDLED_AMAZON_RULES = bundledRulesFor("amazon") as RulesDocument;
import { sanitiseRulesDocument } from "./validateRules";

describe("the committed rules document", () => {
  it("is a shape the interpreter can read", () => {
    const document_ = document as Record<string, unknown>;
    expect(typeof document_.version).toBe("number");
    expect(Number.isInteger(document_.version)).toBe(true);
    expect(typeof document_.site).toBe("string");
    expect(Array.isArray(document_.locales)).toBe(true);
    expect(typeof document_.fields).toBe("object");
  });

  it("declares the four locales SPEC.md section 14 asks for", () => {
    expect([...BUNDLED_AMAZON_RULES.locales].sort()).toEqual(["co.uk", "com", "de", "fr"]);
  });

  it("carries no field the loader would discard", () => {
    const fields = BUNDLED_AMAZON_RULES.fields;
    if (Object.keys(fields).length === 0) {
      expect(sanitiseRulesDocument(document)).toBeNull();
      return;
    }
    const sanitised = sanitiseRulesDocument(document);
    expect(sanitised).not.toBeNull();
    expect(sanitised?.problems).toEqual([]);
  });

  it("stays at a version a published document can beat", () => {
    expect(BUNDLED_AMAZON_RULES.version).toBeGreaterThanOrEqual(0);
  });
});

// schema/sites.json says adding a storefront is an entry there plus a rules
// file. these are the checks that keep that sentence true.
describe("the registry and the bundled rules", () => {
  it("carries rules for every site the registry declares", () => {
    for (const site of SITES) {
      expect(bundledRulesFor(site.id), `no bundled rules for ${site.id}`).not.toBeNull();
    }
  });

  it("carries no rules for a site the registry does not declare", () => {
    const known = new Set(SITES.map((site) => site.id));
    for (const siteId of Object.keys(BUNDLED_RULES)) {
      expect(known.has(siteId), `${siteId} has rules but is not in the registry`).toBe(true);
    }
  });

  it("files each document under the site it names, so nothing is read with another site's rules", () => {
    for (const [siteId, document_] of Object.entries(BUNDLED_RULES)) {
      expect(document_.site).toBe(siteId);
    }
  });

  it("declares only locales the registry knows, since a url is built from them", () => {
    for (const [siteId, document_] of Object.entries(BUNDLED_RULES)) {
      const known = Object.keys(SITES.find((site) => site.id === siteId)?.locales ?? {});
      for (const locale of document_.locales) {
        expect(known, `${siteId} rules name locale ${locale}`).toContain(locale);
      }
    }
  });

  it("uses a site id that can safely become a url path segment", () => {
    for (const site of SITES) {
      expect(site.id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe("emptyRules", () => {
  it("reads nothing rather than reading with somebody else's rules", () => {
    expect(emptyRules("newsite")).toEqual({
      version: 0,
      site: "newsite",
      locales: [],
      fields: {},
    });
  });
});
