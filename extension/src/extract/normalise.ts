export interface LocaleFormat {
  groupSeparators: readonly string[];
  decimalSeparator: string;
  months: ReadonlyMap<string, number>;
  numericOrder: "dmy" | "mdy" | "ymd";
  // india groups the last three digits and then in twos, so 1,23,456 is one number
  grouping?: "indian";
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

// a storefront serving two languages writes its dates in either of them
function mergedMonths(
  ...tables: readonly ReadonlyMap<string, number>[]
): ReadonlyMap<string, number> {
  const merged = new Map<string, number>();
  for (const table of tables) {
    for (const [name, month] of table) {
      merged.set(name, month);
    }
  }
  return merged;
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

const SPANISH_MONTHS = monthTable([
  ["enero", "ene"],
  ["febrero", "feb"],
  ["marzo", "mar"],
  ["abril", "abr"],
  ["mayo", "may"],
  ["junio", "jun"],
  ["julio", "jul"],
  ["agosto", "ago"],
  ["septiembre", "setiembre", "sep", "sept", "set"],
  ["octubre", "oct"],
  ["noviembre", "nov"],
  ["diciembre", "dic"],
]);

const ITALIAN_MONTHS = monthTable([
  ["gennaio", "gen"],
  ["febbraio", "feb"],
  ["marzo", "mar"],
  ["aprile", "apr"],
  ["maggio", "mag"],
  ["giugno", "giu"],
  ["luglio", "lug"],
  ["agosto", "ago"],
  ["settembre", "set"],
  ["ottobre", "ott"],
  ["novembre", "nov"],
  ["dicembre", "dic"],
]);

const DUTCH_MONTHS = monthTable([
  ["januari", "jan"],
  ["februari", "feb"],
  ["maart", "mrt"],
  ["april", "apr"],
  ["mei"],
  ["juni", "jun"],
  ["juli", "jul"],
  ["augustus", "aug"],
  ["september", "sep", "sept"],
  ["oktober", "okt"],
  ["november", "nov"],
  ["december", "dec"],
]);

const PORTUGUESE_MONTHS = monthTable([
  ["janeiro", "jan"],
  ["fevereiro", "fev"],
  ["março", "marco", "mar"],
  ["abril", "abr"],
  ["maio", "mai"],
  ["junho", "jun"],
  ["julho", "jul"],
  ["agosto", "ago"],
  ["setembro", "set"],
  ["outubro", "out"],
  ["novembro", "nov"],
  ["dezembro", "dez"],
]);

const SWEDISH_MONTHS = monthTable([
  ["januari", "jan"],
  ["februari", "feb"],
  ["mars", "mar"],
  ["april", "apr"],
  ["maj"],
  ["juni", "jun"],
  ["juli", "jul"],
  ["augusti", "aug"],
  ["september", "sep"],
  ["oktober", "okt"],
  ["november", "nov"],
  ["december", "dec"],
]);

// polish dates name the month in the genitive, "5 stycznia", not the nominative
const POLISH_MONTHS = monthTable([
  ["stycznia", "styczeń", "styczen", "sty"],
  ["lutego", "luty", "lut"],
  ["marca", "marzec", "mar"],
  ["kwietnia", "kwiecień", "kwiecien", "kwi"],
  ["maja", "maj"],
  ["czerwca", "czerwiec", "cze"],
  ["lipca", "lipiec", "lip"],
  ["sierpnia", "sierpień", "sierpien", "sie"],
  ["września", "wrzesnia", "wrzesień", "wrzesien", "wrz"],
  ["października", "pazdziernika", "październik", "pazdziernik", "paź", "paz"],
  ["listopada", "listopad", "lis"],
  ["grudnia", "grudzień", "grudzien", "gru"],
]);

// amazon.co.jp writes no month names, only 2024年3月2日
const NO_MONTH_NAMES = monthTable([]);

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
  es: {
    groupSeparators: [".", ...SPACES],
    decimalSeparator: ",",
    months: SPANISH_MONTHS,
    numericOrder: "dmy",
  },
  it: {
    groupSeparators: [".", ...SPACES],
    decimalSeparator: ",",
    months: ITALIAN_MONTHS,
    numericOrder: "dmy",
  },
  nl: {
    groupSeparators: [".", ...SPACES],
    decimalSeparator: ",",
    months: DUTCH_MONTHS,
    numericOrder: "dmy",
  },
  se: {
    groupSeparators: [...SPACES],
    decimalSeparator: ",",
    months: SWEDISH_MONTHS,
    numericOrder: "dmy",
  },
  pl: {
    groupSeparators: [...SPACES],
    decimalSeparator: ",",
    months: POLISH_MONTHS,
    numericOrder: "dmy",
  },
  "com.br": {
    groupSeparators: [".", ...SPACES],
    decimalSeparator: ",",
    months: PORTUGUESE_MONTHS,
    numericOrder: "dmy",
  },
  "com.mx": {
    groupSeparators: [",", ...SPACES],
    decimalSeparator: ".",
    months: SPANISH_MONTHS,
    numericOrder: "dmy",
  },
  ca: {
    groupSeparators: [",", ...SPACES],
    decimalSeparator: ".",
    // the storefront is served in english and in french from the same domain
    months: mergedMonths(ENGLISH_MONTHS, FRENCH_MONTHS),
    numericOrder: "mdy",
  },
  "com.au": {
    groupSeparators: [",", ...SPACES],
    decimalSeparator: ".",
    months: ENGLISH_MONTHS,
    numericOrder: "dmy",
  },
  in: {
    groupSeparators: [",", ...SPACES],
    decimalSeparator: ".",
    months: ENGLISH_MONTHS,
    numericOrder: "dmy",
    grouping: "indian",
  },
  "co.jp": {
    groupSeparators: [",", ...SPACES],
    decimalSeparator: ".",
    months: NO_MONTH_NAMES,
    numericOrder: "ymd",
  },
};

export function localeFormat(locale: string): LocaleFormat | null {
  return LOCALE_FORMATS[locale] ?? null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function escapeClass(characters: readonly string[]): string {
  return characters.map((character) => character.replace(/[\\\]^-]/g, "\\$&")).join("");
}

function numberPattern(format: LocaleFormat): RegExp {
  const group = escapeClass(format.groupSeparators);
  const decimal = escapeClass([format.decimalSeparator]);
  const grouped =
    format.grouping === "indian"
      ? `\\d{1,2}(?:[${group}]\\d{2})+[${group}]\\d{3}|\\d{1,3}(?:[${group}]\\d{3})+`
      : `\\d{1,3}(?:[${group}]\\d{3})+`;
  return new RegExp(`-?(?:${grouped}|\\d+)(?:[${decimal}]\\d+)?`);
}

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

// 2024年3月2日, and the same order written with the separators the west uses
const YEAR_FIRST_DATE = /(\d{4})[.年/-]\s*(\d{1,2})[.月/-]\s*(\d{1,2})/;

function fromYearFirst(raw: string): string | null {
  const match = YEAR_FIRST_DATE.exec(raw);
  if (match === null) {
    return null;
  }
  return buildDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function fromDigits(raw: string, format: LocaleFormat): string | null {
  if (format.numericOrder === "ymd") {
    return fromYearFirst(raw);
  }
  const match = DIGIT_DATE.exec(raw);
  if (match === null) {
    return null;
  }
  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = expandYear(Number(match[3]), (match[3] as string).length);
  const [day, month] = format.numericOrder === "mdy" ? [second, first] : [first, second];
  return buildDate(year, month, day);
}

function expandYear(year: number, digits: number): number {
  return digits === 2 ? 2000 + year : year;
}

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
