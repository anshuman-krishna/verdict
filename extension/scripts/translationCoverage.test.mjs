import { describe, expect, it } from "vitest";
import { ENGLISH, MESSAGE_IDS } from "../src/i18n/messages";
import { printable, problems, report, stubFor } from "./translationCoverage.mjs";

describe("report", () => {
  it("counts every shipped catalogue", () => {
    const languages = report().map((row) => row.language);
    expect(languages).toContain("en");
  });

  it("finds nothing wrong with what ships", () => {
    expect(problems(report())).toEqual([]);
  });

  it("names the language a problem is in", () => {
    const found = problems(report({ fr: { "panel.kept": "gardes" } }));
    expect(found).toEqual(["fr: panel.kept interpolates nothing, english interpolates count"]);
  });
});

describe("printable", () => {
  it("gives a share per language", () => {
    expect(printable(report({ en: ENGLISH }))).toContain(`${MESSAGE_IDS.length} of`);
  });
});

describe("stubFor", () => {
  it("writes an entry for every line that has no translation yet", () => {
    const stub = stubFor("fr", { fr: {} });
    for (const id of MESSAGE_IDS) {
      expect(stub).toContain(`${JSON.stringify(id)}:`);
    }
  });

  it("leaves out the lines already translated", () => {
    const stub = stubFor("fr", { fr: { "panel.adjusted": "ajuste" } });
    expect(stub).not.toContain(`"panel.adjusted":`);
    expect(stub).toContain(`"panel.claimed":`);
  });

  it("asks a language for the plural forms that language actually has", () => {
    expect(stubFor("pl", { pl: {} })).toContain(
      `"count.reviews": { one: "", few: "", many: "", other: "" },`,
    );
    expect(stubFor("ja", { ja: {} })).toContain(`"count.reviews": { other: "" },`);
  });

  it("shows the english underneath, so nobody translates blind", () => {
    expect(stubFor("fr", { fr: {} })).toContain("// mostly clean");
  });

  it("names the export after the language", () => {
    expect(stubFor("pt-BR", { "pt-BR": {} })).toContain("export const PT_BR: Catalogue");
  });
});
