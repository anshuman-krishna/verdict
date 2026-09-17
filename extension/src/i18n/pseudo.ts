import {
  ENGLISH,
  isPlural,
  type Catalogue,
  type Message,
  type MessageId,
  type PluralCategory,
} from "./messages.ts";

const ACCENTED: Record<string, string> = {
  a: "á", b: "ƀ", c: "ç", d: "ď", e: "é", f: "ƒ", g: "ğ",
  h: "ĥ", i: "ï", j: "ĵ", k: "ķ", l: "ļ", m: "ḿ", n: "ñ",
  o: "ö", p: "ƥ", q: "ǫ", r: "ř", s: "š", t: "ţ", u: "ü",
  v: "ṽ", w: "ŵ", x: "ẋ", y: "ý", z: "ž",
  A: "Á", B: "Ɓ", C: "Ç", D: "Ď", E: "É", F: "Ƒ", G: "Ğ",
  H: "Ĥ", I: "Ï", J: "Ĵ", K: "Ķ", L: "Ļ", M: "Ḿ", N: "Ñ",
  O: "Ö", P: "Ƥ", Q: "Ǫ", R: "Ř", S: "Š", T: "Ţ", U: "Ü",
  V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ý", Z: "Ž",
};

// german and finnish run about a third longer than english, so a line that only just fits
// in english is a line that has already broken somewhere
const EXPANSION = 0.3;

const PLACEHOLDER = /(\{[a-zA-Z]+\})/;

export function pseudoText(text: string): string {
  const accented = text
    .split(PLACEHOLDER)
    .map((part) =>
      PLACEHOLDER.test(part)
        ? part
        : [...part].map((character) => ACCENTED[character] ?? character).join("")
    )
    .join("");
  const padding = "·".repeat(Math.ceil(text.length * EXPANSION));
  return `[${accented}${padding}]`;
}

const CATEGORIES: readonly PluralCategory[] = ["zero", "one", "two", "few", "many", "other"];

function pseudoMessage(message: Message): Message {
  if (!isPlural(message)) {
    return pseudoText(message);
  }
  const forms: { -readonly [K in PluralCategory]?: string } & { other: string } = {
    other: pseudoText(message.other),
  };
  for (const category of CATEGORIES) {
    const form = message[category];
    if (form !== undefined) {
      forms[category] = pseudoText(form);
    }
  }
  return forms;
}

// every id, on purpose: a line that comes out unaccented is a line that never reached the
// catalogue, which is the only way to find one by looking
export function pseudoCatalogue(): Catalogue {
  const built: Catalogue = {};
  for (const [id, message] of Object.entries(ENGLISH)) {
    built[id as MessageId] = pseudoMessage(message);
  }
  return built;
}
