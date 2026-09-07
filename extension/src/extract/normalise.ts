// parseFloat reads "8,043" as 8 and "4,6" as 4, and v8's Date.parse reads "3 janvier 2026" as local
// midnight, so the same review lands on a different day per timezone. both fail silently.
// null rather than a guess for anything a locale cannot read. an unknown locale normalises nothing.
// in code, not rules.json: selectors change constantly, month names and separators do not.

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

// plain, no break, and narrow no break: the three amazon emits as fr and de group separators
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

function escapeClass(characters: readonly string[]): string {
  return characters.map((character) => character.replace(/[\\\]^-]/g, "\\$&")).join("");
}

// a group separator counts only with three digits after it, so french "4.6" is four, not forty six
function numberPattern(format: LocaleFormat): RegExp {
  const group = escapeClass(format.groupSeparators);
  const decimal = escapeClass([format.decimalSeparator]);
  return new RegExp(
    `-?(?:\\d{1,3}(?:[${group}]\\d{3})+|\\d+)(?:[${decimal}]\\d+)?`,
  );
}

// null rather than a partial read: "8,043" resolving to 8 is the failure this exists to remove
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

// a date the scorer cannot place beats one placed in the wrong month, so anything unreadable is null
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

  // nearest to the month, so "5 out of 5 stars, reviewed on 3 January 2026" does not read as the 5th
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

// amazon does not write two digit years; if one appears, this century is the less strange guess
function expandYear(year: number, digits: number): number {
  return digits === 2 ? 2000 + year : year;
}

// round trips through Date.UTC so 31 february comes back null instead of rolling into march
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
