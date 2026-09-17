import { catalogueFor, isKnownLanguage } from "./catalogues";
import { DEFAULT_TAG, newTranslator, type Translator } from "./translator";

// a storefront locale is where the page is, not who is reading it, so this only answers
// when the browser asked for nothing anything here speaks
export const STOREFRONT_LANGUAGES: Record<string, string> = {
  com: "en-US",
  "co.uk": "en-GB",
  ca: "en-CA",
  "com.au": "en-AU",
  in: "en-IN",
  fr: "fr-FR",
  de: "de-DE",
  es: "es-ES",
  it: "it-IT",
  nl: "nl-NL",
  se: "sv-SE",
  pl: "pl-PL",
  "com.br": "pt-BR",
  "com.mx": "es-MX",
  "co.jp": "ja-JP",
};

export interface LocaleChoice {
  tag: string;
  language: string;
}

export function baseLanguage(tag: string): string {
  return (tag.split("-")[0] as string).toLowerCase();
}

function structural(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length > 0;
  } catch {
    return false;
  }
}

export interface LocaleRequest {
  // navigator.languages, most wanted first
  preferred?: readonly string[];
  storefrontLocale?: string | null;
  // language codes with a catalogue, for a test that wants to pick its own set
  available?: (language: string) => boolean;
}

// numbers and dates follow the reader's own locale even when the words fall back to
// english, because a wrongly grouped number is wrong in every language
export function resolveLocale(request: LocaleRequest = {}): LocaleChoice {
  const preferred = (request.preferred ?? []).filter(structural);
  const available = request.available ?? isKnownLanguage;
  const storefront = request.storefrontLocale ?? null;
  const fromStorefront = storefront === null ? undefined : STOREFRONT_LANGUAGES[storefront];

  const tag = preferred[0] ?? fromStorefront ?? DEFAULT_TAG;
  const spoken = preferred.find((candidate) => available(baseLanguage(candidate)));
  if (spoken !== undefined) {
    return { tag, language: baseLanguage(spoken) };
  }
  if (fromStorefront !== undefined && available(baseLanguage(fromStorefront))) {
    return { tag, language: baseLanguage(fromStorefront) };
  }
  return { tag, language: DEFAULT_TAG };
}

export function translatorFor(request: LocaleRequest = {}): Translator {
  const choice = resolveLocale(request);
  return newTranslator(choice.tag, catalogueFor(choice.language), choice.language);
}

function navigatorLanguages(): string[] {
  if (typeof navigator === "undefined") {
    return [];
  }
  const listed = navigator.languages;
  return Array.isArray(listed) && listed.length > 0
    ? [...listed]
    : navigator.language === undefined
      ? []
      : [navigator.language];
}

export function translatorForBrowser(storefrontLocale: string | null = null): Translator {
  return translatorFor({ preferred: navigatorLanguages(), storefrontLocale });
}
