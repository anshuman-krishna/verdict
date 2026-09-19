import {
  ENGLISH,
  isMessageId,
  isPlural,
  type Catalogue,
  type Message,
  type MessageId,
  type PluralCategory,
} from "./messages";

export type Params = Record<string, string | number>;

export interface Translator {
  // what Intl formats with, which is the reader's own locale even when the words are not
  readonly tag: string;
  // which catalogue answered, "en" when nothing else did
  readonly language: string;
  text: (id: MessageId, params?: Params) => string;
  count: (id: MessageId, value: number, params?: Params) => string;
  number: (value: number) => string;
  decimal: (value: number, digits: number) => string;
  date: (timestamp: number) => string;
  join: (items: readonly string[]) => string;
}

export const DEFAULT_TAG = "en";

function usable(tag: string): boolean {
  try {
    Intl.getCanonicalLocales(tag);
    new Intl.NumberFormat(tag);
    return true;
  } catch {
    return false;
  }
}

// Intl objects are expensive enough that rebuilding one per line shows up on a page with
// forty evidence numbers on it
function memoise<T>(build: () => T): () => T {
  let made: T | null = null;
  return () => (made ??= build());
}

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

function selectForm(message: Message, plural: Intl.PluralRules, value: number | null): string {
  if (!isPlural(message)) {
    return message;
  }
  if (value === null) {
    return message.other;
  }
  const category = plural.select(value) as PluralCategory;
  return message[category] ?? message.other;
}

export function newTranslator(
  tag: string = DEFAULT_TAG,
  catalogue: Catalogue = ENGLISH,
  language: string = DEFAULT_TAG,
): Translator {
  const safeTag = usable(tag) ? tag : DEFAULT_TAG;
  const plain = memoise(() => new Intl.NumberFormat(safeTag));
  // which forms a line has is a fact about the language the line is written in, not about
  // the reader's locale. a japanese browser reading english still wants "a month ago"
  const catalogueRules = memoise(() =>
    new Intl.PluralRules(usable(language) ? language : DEFAULT_TAG)
  );
  const englishRules = memoise(() => new Intl.PluralRules(DEFAULT_TAG));
  const day = memoise(() =>
    new Intl.DateTimeFormat(safeTag, { year: "numeric", month: "short", day: "numeric" })
  );
  const fixed = new Map<number, Intl.NumberFormat>();

  const number = (value: number): string => plain().format(value);

  const decimal = (value: number, digits: number): string => {
    let format = fixed.get(digits);
    if (format === undefined) {
      format = new Intl.NumberFormat(safeTag, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
      fixed.set(digits, format);
    }
    return format.format(value);
  };

  const fill = (form: string, params: Params): string =>
    form.replaceAll(PLACEHOLDER, (whole, name: string) => {
      const value = params[name];
      if (value === undefined) {
        return whole;
      }
      return typeof value === "number" ? number(value) : value;
    });

  const render = (id: MessageId, value: number | null, params: Params): string => {
    const translated = catalogue[id];
    const message = translated ?? ENGLISH[id];
    const rules = translated === undefined ? englishRules() : catalogueRules();
    return fill(selectForm(message, rules, value), params);
  };

  return {
    tag: safeTag,
    language,
    text: (id, params = {}) => render(id, null, params),
    count: (id, value, params = {}) => render(id, value, { ...params, count: value }),
    number,
    decimal,
    date: (timestamp) => day().format(new Date(timestamp)),
    join: (items) => {
      if (items.length < 2) {
        return items[0] ?? "";
      }
      const last = items[items.length - 1] as string;
      return `${items.slice(0, -1).join(", ")} ${render("list.and", null, {})} ${last}`;
    },
  };
}

// what a platform reviews changes the words, not the numbers. a line with a variant for this
// subject is read from it, and every other line is the one line there is
export const DEFAULT_SUBJECT = "product";

export function forSubject(base: Translator, subject: string): Translator {
  if (subject === DEFAULT_SUBJECT) {
    return base;
  }
  const variant = (id: MessageId): MessageId => {
    const candidate = `${id}.${subject}`;
    return isMessageId(candidate) ? candidate : id;
  };
  return {
    ...base,
    text: (id, params) => base.text(variant(id), params),
    count: (id, value, params) => base.count(variant(id), value, params),
  };
}

export const ENGLISH_TRANSLATOR: Translator = newTranslator();
