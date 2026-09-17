import { describe, expect, it } from "vitest";
import { SITES } from "../extract/sites";
import {
  STOREFRONT_LANGUAGES,
  baseLanguage,
  resolveLocale,
  translatorFor,
} from "./locale";

const AVAILABLE = (language: string): boolean => ["en", "de", "ja"].includes(language);

describe("resolveLocale", () => {
  it("formats in the reader's locale even when the words fall back to english", () => {
    const choice = resolveLocale({ preferred: ["sv-SE"], available: AVAILABLE });
    expect(choice.tag).toBe("sv-SE");
    expect(choice.language).toBe("en");
  });

  it("takes the first language the reader asked for that anything here speaks", () => {
    const choice = resolveLocale({ preferred: ["sv-SE", "ja-JP", "de"], available: AVAILABLE });
    expect(choice.language).toBe("ja");
    // formatting still follows what they actually wanted most
    expect(choice.tag).toBe("sv-SE");
  });

  it("falls back to the storefront's language when the browser asked for nothing we have", () => {
    const choice = resolveLocale({
      preferred: ["sv-SE"],
      storefrontLocale: "de",
      available: AVAILABLE,
    });
    expect(choice.language).toBe("de");
  });

  it("prefers the reader over the storefront they happen to be on", () => {
    const choice = resolveLocale({
      preferred: ["ja"],
      storefrontLocale: "de",
      available: AVAILABLE,
    });
    expect(choice.language).toBe("ja");
  });

  it("formats with the storefront when the browser said nothing at all", () => {
    expect(resolveLocale({ storefrontLocale: "com.br", available: AVAILABLE }).tag).toBe("pt-BR");
  });

  it("ignores a language tag no Intl would accept", () => {
    const choice = resolveLocale({ preferred: ["!!", "de"], available: AVAILABLE });
    expect(choice.tag).toBe("de");
    expect(choice.language).toBe("de");
  });

  it("lands on english when nothing else answers", () => {
    expect(resolveLocale({ available: AVAILABLE })).toEqual({ tag: "en", language: "en" });
  });

  it("reads a storefront nobody has mapped as no hint at all", () => {
    const choice = resolveLocale({ storefrontLocale: "co.zz", available: AVAILABLE });
    expect(choice).toEqual({ tag: "en", language: "en" });
  });
});

describe("baseLanguage", () => {
  it("drops the region", () => {
    expect(baseLanguage("pt-BR")).toBe("pt");
    expect(baseLanguage("EN-gb")).toBe("en");
  });
});

describe("translatorFor", () => {
  it("reads a japanese storefront in japanese numbers and english words", () => {
    const t = translatorFor({ preferred: ["ja-JP"] });
    expect(t.language).toBe("en");
    expect(t.decimal(4.6, 1)).toBe("4.6");
  });

  it("gives a german reader german numbers", () => {
    expect(translatorFor({ preferred: ["de-DE"] }).number(8124)).toBe("8.124");
  });
});

describe("every storefront in the registry", () => {
  // a locale with nobody's language is a page read in whatever the browser happened to be
  it("has a language to fall back to", () => {
    const missing = SITES.flatMap((site) =>
      Object.keys(site.locales).filter((locale) => STOREFRONT_LANGUAGES[locale] === undefined)
    );
    expect(missing).toEqual([]);
  });

  it("names languages Intl accepts", () => {
    for (const tag of Object.values(STOREFRONT_LANGUAGES)) {
      expect(Intl.getCanonicalLocales(tag)).toHaveLength(1);
    }
  });
});
