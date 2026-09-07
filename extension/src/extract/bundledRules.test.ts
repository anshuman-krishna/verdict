import { describe, expect, it } from "vitest";
import document from "./rules/amazon.json";
import { BUNDLED_AMAZON_RULES } from "./bundledRules";
import { sanitiseRulesDocument } from "./validateRules";

// bundledRules.ts casts the json with `as`, so nothing checks the file the bundle actually ships.
// a remote document is sanitised on arrival and a published one is refused at signing time, which
// left the bundled copy as the only path a malformed rules document could reach a user by.
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

  // sanitiseRulesDocument refuses a document with no usable field, which the bundled one has by
  // design until the fixture corpus exists. so every field it does carry is checked instead.
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
