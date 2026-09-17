import { ENGLISH, type Catalogue } from "./messages.ts";
import { pseudoCatalogue } from "./pseudo.ts";

// qps-ploc is the conventional pseudo locale tag, so asking for it in a browser is the
// whole setup for seeing which lines are still hardcoded
export const PSEUDO_LANGUAGE = "qps";

// the written languages. the pseudo locale is not one of them: it is built on the way
// past, so nobody who never asks for it pays for building it
export const CATALOGUES: Record<string, Catalogue> = {
  en: ENGLISH,
};

let pseudo: Catalogue | null = null;

export function catalogueFor(language: string): Catalogue {
  if (language === PSEUDO_LANGUAGE) {
    return (pseudo ??= pseudoCatalogue());
  }
  return CATALOGUES[language] ?? ENGLISH;
}

export function isKnownLanguage(language: string): boolean {
  return language === PSEUDO_LANGUAGE || Object.hasOwn(CATALOGUES, language);
}

// what a coverage report counts, the generated one included so a new line cannot be
// added without the pseudo locale reaching it
export function allCatalogues(): Record<string, Catalogue> {
  return { ...CATALOGUES, [PSEUDO_LANGUAGE]: catalogueFor(PSEUDO_LANGUAGE) };
}
