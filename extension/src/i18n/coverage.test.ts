import { describe, expect, it } from "vitest";
import { CATALOGUES, PSEUDO_LANGUAGE, catalogueFor } from "./catalogues";
import { coverageFor, coverageReport, formatCoverage } from "./coverage";
import { ENGLISH, MESSAGE_IDS, placeholdersIn } from "./messages";

describe("the shipped catalogues", () => {
  // a half translated language is a working language, since a missing line falls back to
  // english. a line that interpolates the wrong name does not fall back to anything
  it("interpolate the same names english does, and have every form a plural needs", () => {
    for (const row of coverageReport()) {
      expect({ language: row.language, problems: row.problems }).toEqual({
        language: row.language,
        problems: [],
      });
    }
  });

  it("carry english itself, which is what everything else falls back to", () => {
    expect(CATALOGUES.en).toBe(ENGLISH);
    expect(coverageFor("en", ENGLISH).missing).toEqual([]);
  });

  // every id on purpose, so a line that comes out unaccented is a line still hardcoded
  it("carry a pseudo locale that reaches every line", () => {
    const pseudo = coverageReport().find((row) => row.language === PSEUDO_LANGUAGE);
    expect(pseudo?.missing).toEqual([]);
  });

  // nobody who never asks for it should pay for building it
  it("keep the pseudo locale out of the written ones", () => {
    expect(Object.hasOwn(CATALOGUES, PSEUDO_LANGUAGE)).toBe(false);
    expect(catalogueFor(PSEUDO_LANGUAGE)).toBe(catalogueFor(PSEUDO_LANGUAGE));
  });
});

describe("coverageFor", () => {
  it("counts an empty catalogue as nothing translated", () => {
    const row = coverageFor("fr", {});
    expect(row.translated).toBe(0);
    expect(row.total).toBe(MESSAGE_IDS.length);
    expect(row.missing.length).toBe(MESSAGE_IDS.length);
  });

  it("names a line that would render a placeholder at somebody", () => {
    const row = coverageFor("fr", { "panel.kept": "gardes" });
    expect(row.problems).toEqual([
      "panel.kept interpolates nothing, english interpolates count",
    ]);
  });

  it("names a line that invented a placeholder nothing supplies", () => {
    const row = coverageFor("fr", { "panel.adjusted": "ajuste {total}" });
    expect(row.problems).toEqual([
      "panel.adjusted interpolates total, english interpolates nothing",
    ]);
  });

  it("names a counted line given only one form", () => {
    const row = coverageFor("fr", { "count.reviews": "{count} avis" });
    expect(row.problems).toEqual([
      "count.reviews counts something, so it needs a form per plural category",
    ]);
  });

  it("names the plural forms the language itself needs", () => {
    const row = coverageFor("pl", { "count.pages": { one: "{count}", other: "{count}" } });
    expect(row.problems).toEqual([
      "count.pages has no few, many form, which pl needs",
    ]);
  });

  it("names a line no build has, which is how a rename is caught", () => {
    const row = coverageFor("fr", { "panel.gone": "parti" } as never);
    expect(row.problems).toEqual(["panel.gone is not a message this build has"]);
  });

  it("prints a share per language", () => {
    const printed = formatCoverage([coverageFor("en", ENGLISH)]);
    expect(printed).toBe(`en: ${MESSAGE_IDS.length} of ${MESSAGE_IDS.length} lines, 100 percent`);
  });
});

describe("placeholdersIn", () => {
  it("gathers names across every plural form, once each", () => {
    expect(placeholdersIn({ one: "{count} of {total}", other: "{count} of {total}" })).toEqual([
      "count",
      "total",
    ]);
  });
});
