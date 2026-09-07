// SPEC.md section 14 wants correct extraction across at least four locales,
// and score/featureVector.ts's dayIndex requires an ISO date. A page does
// not carry either: amazon writes "8,043 global ratings" on .com, "8.043
// Sternebewertungen" on .de, and dates as "3 janvier 2026" or "Reviewed in
// the United States on January 3, 2026".
//
// Passing those straight through is worse than failing on them. parseFloat
// reads "8,043" as 8 and "4,6" as 4, and Date.parse accepts "3 janvier
// 2026" on v8 as a favour, returning local midnight, so the same review
// lands on different days depending on the reader's timezone and a burst
// boundary moves with it. Both are silent.
//
// So this module turns what a page says into what the scorer requires, and
// returns null for anything it cannot read rather than a number that looks
// fine. Nothing here guesses: the locale decides which separator is which,
// and an unrecognised locale normalises nothing at all.
//
// Kept in code rather than in rules.json, unlike the selectors beside it.
// SPEC.md section 9's reason for rules being data is that selectors change
// constantly. Month names and decimal separators do not.

export interface LocaleFormat {
  groupSeparators: readonly string[];
  decimalSeparator: string;
  // lowercased month name or abbreviation to its 1 based number
  months: ReadonlyMap<string, number>;
  // how to read a date written only in digits
  numericOrder: "dmy" | "mdy";
}

function monthTable(names: readonly (readonly string[])[]): ReadonlyMap<string, number> {
  const table = new Map<string, number>();
  names.forEach((forms, index) => {
    for (const form of forms) {
      table.set(form, index + 1);
    }
  });
  return table;
}

const ENGLISH_MONTHS = monthTable([
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sep", "sept"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
]);

const FRENCH_MONTHS = monthTable([
  ["janvier", "janv"],
  ["février", "fevrier", "févr", "fevr", "fév", "fev"],
  ["mars"],
  ["avril", "avr"],
  ["mai"],
  ["juin"],
  ["juillet", "juil", "juill"],
  ["août", "aout"],
  ["septembre", "sept"],
  ["octobre", "oct"],
  ["novembre", "nov"],
  ["décembre", "decembre", "déc", "dec"],
]);

const GERMAN_MONTHS = monthTable([
  ["januar", "jan"],
  ["februar", "feb"],
  ["märz", "marz", "mär", "mrz"],
  ["april", "apr"],
  ["mai"],
  ["juni", "jun"],
  ["juli", "jul"],
  ["august", "aug"],
  ["september", "sep", "sept"],
  ["oktober", "okt"],
  ["november", "nov"],
  ["dezember", "dez"],
]);

// the space forms are the ones amazon actually emits in fr and de group
// separators: a plain space, a no break space, and a narrow no break space.
const SPACES = [" ", " ", " "] as const;

export const LOCALE_FORMATS: Readonly<Record<string, LocaleFormat>> = {
  com: {
    groupSeparators: [",", ...SPACES],
    decimalSeparator: ".",
    months: ENGLISH_MONTHS,
    numericOrder: "mdy",
  },
  "co.uk": {
    groupSeparators: [",", ...SPACES],
    decimalSeparator: ".",
    months: ENGLISH_MONTHS,
    numericOrder: "dmy",
  },
  fr: {
    groupSeparators: [".", ...SPACES],
    decimalSeparator: ",",
    months: FRENCH_MONTHS,
    numericOrder: "dmy",
  },
  de: {
    groupSeparators: [".", ...SPACES],
    decimalSeparator: ",",
    months: GERMAN_MONTHS,
    numericOrder: "dmy",
  },
};

export function localeFormat(locale: string): LocaleFormat | null {
  return LOCALE_FORMATS[locale] ?? null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// the first number in the string, read with this locale's separators. Null
// when the locale is unknown or nothing in the string is a number, never a
// partial read: "8,043" resolving to 8 is exactly the failure this exists
// to remove.
function escapeClass(characters: readonly string[]): string {
  return characters.map((character) => character.replace(/[\\\]^-]/g, "\\$&")).join("");
}

// a group separator only counts when three digits follow it, so french
// "4.6" is four, not forty six: a page writing four point six in french
// writes "4,6". Anything that is not a well formed group is where the
// number ends.
function numberPattern(format: LocaleFormat): RegExp {
  const group = escapeClass(format.groupSeparators);
  const decimal = escapeClass([format.decimalSeparator]);
  return new RegExp(
    `-?(?:\\d{1,3}(?:[${group}]\\d{3})+|\\d+)(?:[${decimal}]\\d+)?`,
  );
}

// the first number in the string, read with this locale's separators. Null
// when the locale is unknown or nothing in the string is a number, never a
// partial read: "8,043" resolving to 8 is exactly the failure this exists
// to remove.
export function normaliseNumber(raw: string, locale: string): number | null {
  const format = localeFormat(locale);
  if (format === null) {
    return null;
  }
  const match = numberPattern(format).exec(raw);
  if (match === null) {
    return null;
  }
  let digits = match[0];
  for (const separator of format.groupSeparators) {
    digits = digits.split(separator).join("");
  }
  digits = digits.split(format.decimalSeparator).join(".");
  const parsed = Number.parseFloat(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

interface Token {
  text: string;
  isNumber: boolean;
}

function tokenise(raw: string): Token[] {
  const tokens: Token[] = [];
  for (const match of raw.toLowerCase().matchAll(/(\d+)|([\p{L}]+)/gu)) {
    tokens.push({ text: match[0], isNumber: match[1] !== undefined });
  }
  return tokens;
}

// "YYYY-MM-DD", or null. Reads an already ISO date unchanged, a date
// written with a month name in this locale's language, or a date written
// only in digits, in this locale's order. Everything else is null: a date
// the scorer cannot place is better than one placed in the wrong month.
export function normaliseDate(raw: string, locale: string): string | null {
  const trimmed = raw.trim();
  const iso = ISO_DATE.exec(trimmed);
  if (iso !== null) {
    return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const format = localeFormat(locale);
  if (format === null) {
    return null;
  }
  return fromMonthName(trimmed, format) ?? fromDigits(trimmed, format);
}

function fromMonthName(raw: string, format: LocaleFormat): string | null {
  const tokens = tokenise(raw);
  const monthIndex = tokens.findIndex(
    (token) => !token.isNumber && format.months.has(token.text),
  );
  if (monthIndex === -1) {
    return null;
  }
  const month = format.months.get((tokens[monthIndex] as Token).text) as number;

  // nearest outward from the month, so a stray number elsewhere in the
  // sentence ("5 out of 5 stars, reviewed on 3 January 2026") does not win
  // over the one actually beside it.
  const yearIndex = nearestNumber(tokens, monthIndex, (text) => text.length === 4);
  if (yearIndex === null) {
    return null;
  }
  const dayIndex = nearestNumber(
    tokens,
    monthIndex,
    (text) => text.length <= 2,
    new Set([yearIndex]),
  );
  if (dayIndex === null) {
    return null;
  }
  return buildDate(
    Number((tokens[yearIndex] as Token).text),
    month,
    Number((tokens[dayIndex] as Token).text),
  );
}

function nearestNumber(
  tokens: readonly Token[],
  from: number,
  accept: (text: string) => boolean,
  exclude: ReadonlySet<number> = new Set(),
): number | null {
  for (let distance = 1; distance < tokens.length; distance += 1) {
    for (const index of [from - distance, from + distance]) {
      const token = tokens[index];
      if (
        token !== undefined &&
        token.isNumber &&
        !exclude.has(index) &&
        accept(token.text)
      ) {
        return index;
      }
    }
  }
  return null;
}

const DIGIT_DATE = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/;

function fromDigits(raw: string, format: LocaleFormat): string | null {
  const match = DIGIT_DATE.exec(raw);
  if (match === null) {
    return null;
  }
  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = expandYear(Number(match[3]), (match[3] as string).length);
  const [day, month] = format.numericOrder === "dmy" ? [first, second] : [second, first];
  return buildDate(year, month, day);
}

// a two digit year is read as this century. Amazon does not write them, so
// this only ever fires on a page shape nobody has seen; reading 26 as 1926
// would be a stranger guess than reading it as 2026.
function expandYear(year: number, digits: number): number {
  return digits === 2 ? 2000 + year : year;
}

// round trips through Date.UTC so an impossible date (31 february, month
// 13) comes back null rather than rolling silently into the next month.
function buildDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
