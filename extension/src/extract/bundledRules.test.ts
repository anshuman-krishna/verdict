import { describe, expect, it } from "vitest";
import document from "./rules/amazon.json";
import { BUNDLED_AMAZON_RULES } from "./bundledRules";
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
