export interface LocaleFormat {
  groupSeparators: readonly string[];
  decimalSeparator: string;
  months: ReadonlyMap<string, number>;
  numericOrder: "dmy" | "mdy" | "ymd";
  // india groups the last three digits and then in twos, so 1,23,456 is one number
  grouping?: "indian";
  // absent means the storefront writes absolute dates only
  relative?: RelativeFormat;
}

// how wide the window is that the page named, so a reader downstream knows what the date
// can carry. absent on a review means exact, which is what an absolute date is
export type DatePrecision = "exact" | "day" | "week" | "month" | "year";

export interface DateReading {
  date: string;
  precision: DatePrecision;
}

type RelativeUnit = "today" | "day" | "week" | "month" | "year";

export interface RelativeFormat {
  // the word that says the date is behind us, wherever the language puts it
  markers: readonly string[];
  units: ReadonlyMap<string, RelativeUnit>;
  // "a month ago" counts as one, and every language spells that differently
  ones: readonly string[];
  today: readonly string[];
  yesterday: readonly string[];
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

function relativeUnits(
  entries: readonly (readonly [RelativeUnit, readonly string[]])[],
): ReadonlyMap<string, RelativeUnit> {
  const table = new Map<string, RelativeUnit>();
  for (const [unit, words] of entries) {
    for (const word of words) {
      table.set(word, unit);
    }
  }
  return table;
}

function mergedRelative(...formats: readonly RelativeFormat[]): RelativeFormat {
  const units = new Map<string, RelativeUnit>();
  for (const format of formats) {
    for (const [word, unit] of format.units) {
      units.set(word, unit);
    }
  }
  return {
    markers: formats.flatMap((format) => [...format.markers]),
    units,
    ones: formats.flatMap((format) => [...format.ones]),
    today: formats.flatMap((format) => [...format.today]),
    yesterday: formats.flatMap((format) => [...format.yesterday]),
  };
}

const ENGLISH_RELATIVE: RelativeFormat = {
  markers: ["ago"],
  units: relativeUnits([
    ["today", ["second", "seconds", "minute", "minutes", "hour", "hours", "moment", "moments"]],
    ["day", ["day", "days"]],
    ["week", ["week", "weeks"]],
    ["month", ["month", "months"]],
    ["year", ["year", "years"]],
  ]),
  ones: ["a", "an", "one"],
  today: ["today", "now"],
  yesterday: ["yesterday"],
};

// aujourd'hui tokenises as two words, so the first of them is what is matched
const FRENCH_RELATIVE: RelativeFormat = {
  markers: ["il y a"],
  units: relativeUnits([
    ["today", ["seconde", "secondes", "minute", "minutes", "heure", "heures", "instant"]],
    ["day", ["jour", "jours"]],
    ["week", ["semaine", "semaines"]],
    ["month", ["mois"]],
    ["year", ["an", "ans", "année", "annee", "années", "annees"]],
  ]),
  ones: ["un", "une"],
  today: ["aujourd", "maintenant"],
  yesterday: ["hier"],
};

const GERMAN_RELATIVE: RelativeFormat = {
  markers: ["vor"],
  units: relativeUnits([
    ["today", ["sekunde", "sekunden", "minute", "minuten", "stunde", "stunden", "augenblick"]],
    ["day", ["tag", "tage", "tagen"]],
    ["week", ["woche", "wochen"]],
    ["month", ["monat", "monate", "monaten"]],
    ["year", ["jahr", "jahre", "jahren"]],
  ]),
  ones: ["ein", "eine", "einem", "einen", "einer"],
  today: ["heute", "jetzt"],
  yesterday: ["gestern"],
};

const SPANISH_RELATIVE: RelativeFormat = {
  markers: ["hace"],
  units: relativeUnits([
    ["today", ["segundo", "segundos", "minuto", "minutos", "hora", "horas", "momento"]],
    ["day", ["día", "dia", "días", "dias"]],
    ["week", ["semana", "semanas"]],
    ["month", ["mes", "meses"]],
    ["year", ["año", "ano", "años", "anos"]],
  ]),
  ones: ["un", "una", "uno"],
  today: ["hoy", "ahora"],
  yesterday: ["ayer"],
};

const ITALIAN_RELATIVE: RelativeFormat = {
  markers: ["fa"],
  units: relativeUnits([
    ["today", ["secondo", "secondi", "minuto", "minuti", "ora", "ore", "istante"]],
    ["day", ["giorno", "giorni"]],
    ["week", ["settimana", "settimane"]],
    ["month", ["mese", "mesi"]],
    ["year", ["anno", "anni"]],
  ]),
  ones: ["un", "una", "uno"],
  today: ["oggi", "adesso"],
  yesterday: ["ieri"],
};

const DUTCH_RELATIVE: RelativeFormat = {
  markers: ["geleden"],
  units: relativeUnits([
    ["today", ["seconde", "seconden", "minuut", "minuten", "uur", "moment"]],
    ["day", ["dag", "dagen"]],
    ["week", ["week", "weken"]],
    ["month", ["maand", "maanden"]],
    ["year", ["jaar", "jaren"]],
  ]),
  ones: ["een", "één"],
  today: ["vandaag", "nu"],
  yesterday: ["gisteren"],
};

const SWEDISH_RELATIVE: RelativeFormat = {
  markers: ["sedan", "sen", "för"],
  units: relativeUnits([
    ["today", ["sekund", "sekunder", "minut", "minuter", "timme", "timmar"]],
    ["day", ["dag", "dagar"]],
    ["week", ["vecka", "veckor"]],
    ["month", ["månad", "manad", "månader", "manader"]],
    ["year", ["år", "ar", "åren"]],
  ]),
  ones: ["en", "ett"],
  today: ["idag", "nu"],
  yesterday: ["igår", "igar"],
};

// polish counts in three forms, so every one of them is listed rather than stemmed
const POLISH_RELATIVE: RelativeFormat = {
  markers: ["temu"],
  units: relativeUnits([
    ["today", [
      "sekundę",
      "sekunde",
      "sekundy",
      "sekund",
      "minutę",
      "minute",
      "minuty",
      "minut",
      "godzinę",
      "godzine",
      "godziny",
      "godzin",
    ]],
    ["day", ["dzień", "dzien", "dnia", "dni"]],
    ["week", ["tydzień", "tydzien", "tygodnia", "tygodnie", "tygodni"]],
    ["month", ["miesiąc", "miesiac", "miesiąca", "miesiace", "miesiące", "miesięcy", "miesiecy"]],
    ["year", ["rok", "roku", "lata", "lat"]],
  ]),
  // polish leaves the one implicit, so "rok temu" is a year ago with nothing to count
  ones: [
    "jeden",
    "jedną",
    "jedna",
    "dzień",
    "dzien",
    "tydzień",
    "tydzien",
    "miesiąc",
    "miesiac",
    "rok",
  ],
  today: ["dzisiaj", "dziś", "dzis", "teraz"],
  yesterday: ["wczoraj"],
};

const PORTUGUESE_RELATIVE: RelativeFormat = {
  markers: ["há", "ha", "faz", "atrás", "atras"],
  units: relativeUnits([
    ["today", ["segundo", "segundos", "minuto", "minutos", "hora", "horas", "momento"]],
    ["day", ["dia", "dias"]],
    ["week", ["semana", "semanas"]],
    ["month", ["mês", "mes", "meses"]],
    ["year", ["ano", "anos"]],
  ]),
  ones: ["um", "uma"],
  today: ["hoje", "agora"],
  yesterday: ["ontem"],
};

// japanese writes no spaces, so the unit and the marker arrive as one token
const JAPANESE_RELATIVE: RelativeFormat = {
  markers: ["前"],
  units: relativeUnits([
    ["today", ["秒前", "分前", "時間前"]],
    ["day", ["日前"]],
    ["week", ["週間前"]],
    ["month", ["か月前", "ヶ月前", "カ月前", "ケ月前", "箇月前"]],
    ["year", ["年前"]],
  ]),
  ones: [],
  today: ["今日", "たった今"],
  yesterday: ["昨日"],
};

const SPACES = [" ", " ", " "] as const;

export const LOCALE_FORMATS: Readonly<Record<string, LocaleFormat>> = {
  com: {
    groupSeparators: [",", ...SPACES],
    decimalSeparator: ".",
    months: ENGLISH_MONTHS,
    numericOrder: "mdy",
    relative: ENGLISH_RELATIVE,
  },
  "co.uk": {
    groupSeparators: [",", ...SPACES],
    decimalSeparator: ".",
    months: ENGLISH_MONTHS,
    numericOrder: "dmy",
    relative: ENGLISH_RELATIVE,
  },
  fr: {
    groupSeparators: [".", ...SPACES],
    decimalSeparator: ",",
    months: FRENCH_MONTHS,
    numericOrder: "dmy",
    relative: FRENCH_RELATIVE,
  },
  de: {
    groupSeparators: [".", ...SPACES],
    decimalSeparator: ",",
    months: GERMAN_MONTHS,
    numericOrder: "dmy",
    relative: GERMAN_RELATIVE,
  },
  es: {
    groupSeparators: [".", ...SPACES],
    decimalSeparator: ",",
    months: SPANISH_MONTHS,
    numericOrder: "dmy",
    relative: SPANISH_RELATIVE,
  },
  it: {
    groupSeparators: [".", ...SPACES],
    decimalSeparator: ",",
    months: ITALIAN_MONTHS,
    numericOrder: "dmy",
    relative: ITALIAN_RELATIVE,
  },
  nl: {
    groupSeparators: [".", ...SPACES],
    decimalSeparator: ",",
    months: DUTCH_MONTHS,
    numericOrder: "dmy",
    relative: DUTCH_RELATIVE,
  },
  se: {
    groupSeparators: [...SPACES],
    decimalSeparator: ",",
    months: SWEDISH_MONTHS,
    numericOrder: "dmy",
    relative: SWEDISH_RELATIVE,
  },
  pl: {
    groupSeparators: [...SPACES],
    decimalSeparator: ",",
    months: POLISH_MONTHS,
    numericOrder: "dmy",
    relative: POLISH_RELATIVE,
  },
  "com.br": {
    groupSeparators: [".", ...SPACES],
    decimalSeparator: ",",
    months: PORTUGUESE_MONTHS,
    numericOrder: "dmy",
    relative: PORTUGUESE_RELATIVE,
  },
  "com.mx": {
    groupSeparators: [",", ...SPACES],
    decimalSeparator: ".",
    months: SPANISH_MONTHS,
    numericOrder: "dmy",
    relative: SPANISH_RELATIVE,
  },
  ca: {
    groupSeparators: [",", ...SPACES],
    decimalSeparator: ".",
    // the storefront is served in english and in french from the same domain
    months: mergedMonths(ENGLISH_MONTHS, FRENCH_MONTHS),
    numericOrder: "mdy",
    relative: mergedRelative(ENGLISH_RELATIVE, FRENCH_RELATIVE),
  },
  "com.au": {
    groupSeparators: [",", ...SPACES],
    decimalSeparator: ".",
    months: ENGLISH_MONTHS,
    numericOrder: "dmy",
    relative: ENGLISH_RELATIVE,
  },
  in: {
    groupSeparators: [",", ...SPACES],
    decimalSeparator: ".",
    months: ENGLISH_MONTHS,
    numericOrder: "dmy",
    grouping: "indian",
    relative: ENGLISH_RELATIVE,
  },
  "co.jp": {
    groupSeparators: [",", ...SPACES],
    decimalSeparator: ".",
    months: NO_MONTH_NAMES,
    numericOrder: "ymd",
    relative: JAPANESE_RELATIVE,
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

// a date the page wrote as text relative to when it was served resolves against the moment
// it was read, and carries how wide the window it named was
export function normaliseDateReading(
  raw: string,
  locale: string,
  now: number,
): DateReading | null {
  const absolute = normaliseDate(raw, locale);
  if (absolute !== null) {
    return { date: absolute, precision: "exact" };
  }
  const format = localeFormat(locale);
  if (format?.relative === undefined) {
    return null;
  }
  return fromRelative(raw.trim(), format.relative, now);
}

// a count nobody would write on a review page is a number read out of something else
const MAX_RELATIVE_COUNT = 1000;

function fromRelative(raw: string, format: RelativeFormat, now: number): DateReading | null {
  const lowered = raw.toLowerCase();
  const tokens = tokenise(raw);
  const words = new Set(tokens.filter((token) => !token.isNumber).map((token) => token.text));

  if (format.today.some((word) => words.has(word))) {
    return dayReading(now, 0);
  }
  if (format.yesterday.some((word) => words.has(word))) {
    return dayReading(now, 1);
  }
  if (!format.markers.some((marker) => words.has(marker) || lowered.includes(marker))) {
    return null;
  }

  const unitToken = tokens.find((token) => !token.isNumber && format.units.has(token.text));
  if (unitToken === undefined) {
    return null;
  }
  const unit = format.units.get(unitToken.text) as RelativeUnit;

  const count = relativeCount(tokens, format);
  if (count === null) {
    return null;
  }

  switch (unit) {
    case "today":
      return dayReading(now, 0);
    case "day":
      return dayReading(now, count);
    case "week":
      return weekReading(now, count);
    case "month":
      return monthsBack(now, count, "month");
    case "year":
      return monthsBack(now, count * 12, "year");
  }
}

function relativeCount(tokens: readonly Token[], format: RelativeFormat): number | null {
  const digits = tokens.find((token) => token.isNumber);
  if (digits !== undefined) {
    const count = Number(digits.text);
    return Number.isInteger(count) && count >= 0 && count <= MAX_RELATIVE_COUNT ? count : null;
  }
  return tokens.some((token) => !token.isNumber && format.ones.includes(token.text)) ? 1 : null;
}

function dayReading(now: number, daysBack: number): DateReading | null {
  const date = shiftDays(now, daysBack);
  return date === null ? null : { date, precision: "day" };
}

function weekReading(now: number, weeksBack: number): DateReading | null {
  const date = shiftDays(now, weeksBack * 7);
  return date === null ? null : { date, precision: "week" };
}

function shiftDays(now: number, daysBack: number): string | null {
  const shifted = new Date(now - daysBack * 86_400_000);
  return buildDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

// the last day of a month has no counterpart in a shorter one, so it lands on its last day
function monthsBack(now: number, monthsBack: number, precision: DatePrecision): DateReading | null {
  const from = new Date(now);
  const total = from.getUTCFullYear() * 12 + from.getUTCMonth() - monthsBack;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  const day = Math.min(from.getUTCDate(), daysInMonth(year, month));
  const date = buildDate(year, month, day);
  return date === null ? null : { date, precision };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
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
