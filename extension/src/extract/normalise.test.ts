import { describe, expect, it } from "vitest";
import { SITES } from "./sites";
import { LOCALE_FORMATS, localeFormat, normaliseDate, normaliseNumber } from "./normalise";

describe("normaliseNumber", () => {
  it.each([
    ["com", "8,043 global ratings", 8043],
    ["com", "4.6 out of 5 stars", 4.6],
    ["com", "1,234.56", 1234.56],
    ["co.uk", "8,043 global ratings", 8043],
    ["co.uk", "4.6 out of 5", 4.6],
    ["de", "8.043 Sternebewertungen", 8043],
    ["de", "4,6 von 5 Sternen", 4.6],
    ["fr", "1 234 évaluations", 1234],
    ["fr", "4,6 sur 5", 4.6],
  ])("%s reads %s as %s", (locale, raw, expected) => {
    expect(normaliseNumber(raw, locale)).toBe(expected);
  });

  it("does not read a thousands separator as a decimal point", () => {
    expect(Number.parseFloat("8,043")).toBe(8);
    expect(normaliseNumber("8,043", "com")).toBe(8043);
  });

  it("does not drop a comma decimal separator", () => {
    expect(Number.parseFloat("4,6")).toBe(4);
    expect(normaliseNumber("4,6", "fr")).toBe(4.6);
  });

  it("requires three digits after a group separator", () => {
    expect(normaliseNumber("4.6", "fr")).toBe(4);
    expect(normaliseNumber("8.043", "fr")).toBe(8043);
    expect(normaliseNumber("1,23", "com")).toBe(1);
  });

  it("reads a narrow and a non breaking space as french grouping", () => {
    expect(normaliseNumber("1 234", "fr")).toBe(1234);
    expect(normaliseNumber("1 234", "fr")).toBe(1234);
  });

  it("takes the first number, not the largest or the last", () => {
    expect(normaliseNumber("4.6 out of 5 stars from 8,043 ratings", "com")).toBe(4.6);
  });

  it("reads a negative number", () => {
    expect(normaliseNumber("-2.5", "com")).toBe(-2.5);
  });

  it("returns null when there is no number at all", () => {
    expect(normaliseNumber("no ratings yet", "com")).toBeNull();
    expect(normaliseNumber("", "com")).toBeNull();
  });

  it("returns null for a locale it does not know", () => {
    expect(normaliseNumber("8,043", "jp")).toBeNull();
  });
});

describe("normaliseDate", () => {
  it.each([
    ["com", "Reviewed in the United States on January 3, 2026"],
    ["co.uk", "Reviewed in the United Kingdom on 3 January 2026"],
    ["fr", "Commenté en France le 3 janvier 2026"],
    ["de", "Rezension aus Deutschland vom 3. Januar 2026"],
  ])("%s reads its own review date line", (locale, raw) => {
    expect(normaliseDate(raw, locale)).toBe("2026-01-03");
  });

  it("passes an already iso date through", () => {
    expect(normaliseDate("2026-01-03", "de")).toBe("2026-01-03");
  });

  it("reads month abbreviations", () => {
    expect(normaliseDate("3 Jan 2026", "co.uk")).toBe("2026-01-03");
    expect(normaliseDate("3 janv 2026", "fr")).toBe("2026-01-03");
    expect(normaliseDate("3. Dez 2026", "de")).toBe("2026-12-03");
  });

  it("reads accented and unaccented french and german month names", () => {
    expect(normaliseDate("3 février 2026", "fr")).toBe("2026-02-03");
    expect(normaliseDate("3 fevrier 2026", "fr")).toBe("2026-02-03");
    expect(normaliseDate("3. März 2026", "de")).toBe("2026-03-03");
    expect(normaliseDate("3. Marz 2026", "de")).toBe("2026-03-03");
  });

  it("reads a digit only date in the locale's order", () => {
    expect(normaliseDate("03/01/2026", "com")).toBe("2026-03-01");
    expect(normaliseDate("03/01/2026", "co.uk")).toBe("2026-01-03");
    expect(normaliseDate("03.01.2026", "de")).toBe("2026-01-03");
  });

  it("takes the day beside the month, not a stray number elsewhere", () => {
    expect(normaliseDate("5 out of 5 stars, reviewed on 3 January 2026", "co.uk")).toBe(
      "2026-01-03",
    );
  });

  it("returns null for an impossible date rather than rolling it forward", () => {
    expect(normaliseDate("31 February 2026", "co.uk")).toBeNull();
    expect(normaliseDate("32/01/2026", "co.uk")).toBeNull();
    expect(normaliseDate("2026-02-31", "com")).toBeNull();
  });

  it("accepts a real leap day and rejects one that is not", () => {
    expect(normaliseDate("29 February 2024", "co.uk")).toBe("2024-02-29");
    expect(normaliseDate("29 February 2026", "co.uk")).toBeNull();
  });

  it("returns null for a month name from another language", () => {
    expect(normaliseDate("3 janvier 2026", "de")).toBeNull();
    expect(normaliseDate("3. Januar 2026", "fr")).toBeNull();
  });

  it("returns null when the year or the day is missing", () => {
    expect(normaliseDate("January 2026", "com")).toBeNull();
    expect(normaliseDate("3 January", "co.uk")).toBeNull();
  });

  it("returns null for a locale it does not know", () => {
    expect(normaliseDate("3 January 2026", "jp")).toBeNull();
  });

  it("returns null for text with no date in it", () => {
    expect(normaliseDate("Verified Purchase", "com")).toBeNull();
  });
});

describe("what normalising a date fixes", () => {
  it("produces a date whose day index does not depend on the reader's timezone", () => {
    const normalised = normaliseDate("Commenté en France le 3 janvier 2026", "fr") as string;
    expect(normalised).toBe("2026-01-03");
    expect(Date.parse(normalised)).toBe(Date.UTC(2026, 0, 3));
  });
});

describe("locale coverage", () => {
  const registered = SITES.flatMap((site) => Object.keys(site.locales));

  it("carries a format for every locale the registry declares", () => {
    for (const locale of registered) {
      expect(localeFormat(locale), `no number and date format for ${locale}`).not.toBeNull();
    }
  });

  it("carries no format for a locale nothing serves, which would be a dead table", () => {
    for (const locale of Object.keys(LOCALE_FORMATS)) {
      expect(registered, `${locale} has a format but no storefront`).toContain(locale);
    }
  });

  it("returns null rather than a format for anything else", () => {
    expect(localeFormat("com.tr")).toBeNull();
  });
});

// PLAN.md roadmap 0.4, locale expansion. one line per marketplace, with the number
// and the date written the way that storefront writes them.
describe("the marketplaces beyond the first four", () => {
  const cases = [
    { locale: "es", count: "8.043 valoraciones", rating: "4,6 de 5", date: "Revisado en España el 5 de enero de 2026" },
    { locale: "it", count: "8.043 recensioni", rating: "4,6 su 5", date: "Recensito in Italia il 5 gennaio 2026" },
    { locale: "nl", count: "8.043 beoordelingen", rating: "4,6 van 5", date: "Beoordeeld in Nederland op 5 januari 2026" },
    { locale: "se", count: "8 043 betyg", rating: "4,6 av 5", date: "Recenserad i Sverige den 5 januari 2026" },
    { locale: "pl", count: "8 043 opinii", rating: "4,6 na 5", date: "Zweryfikowana opinia z Polski z 5 stycznia 2026" },
    { locale: "com.br", count: "8.043 avaliações", rating: "4,6 de 5", date: "Avaliado no Brasil em 5 de janeiro de 2026" },
    { locale: "com.mx", count: "8,043 calificaciones", rating: "4.6 de 5", date: "Revisado en México el 5 de enero de 2026" },
    { locale: "ca", count: "8,043 global ratings", rating: "4.6 out of 5", date: "Reviewed in Canada on January 5, 2026" },
    { locale: "com.au", count: "8,043 global ratings", rating: "4.6 out of 5", date: "Reviewed in Australia on 5 January 2026" },
    { locale: "in", count: "8,043 global ratings", rating: "4.6 out of 5", date: "Reviewed in India on 5 January 2026" },
    { locale: "co.jp", count: "8,043件のグローバル評価", rating: "4.6", date: "2026年1月5日に日本でレビュー済み" },
  ];

  for (const { locale, count, rating, date } of cases) {
    it(`reads amazon.${locale} the way that storefront writes things`, () => {
      expect(normaliseNumber(count, locale)).toBe(8043);
      expect(normaliseNumber(rating, locale)).toBe(4.6);
      expect(normaliseDate(date, locale)).toBe("2026-01-05");
    });
  }

  // a rule names the node holding the value. where the sentence opens with another
  // number, as japanese does in "5つ星のうち4.6", the rule has to target it exactly.
  it("reads the first number in the text it is given, wherever the sentence starts", () => {
    expect(normaliseNumber("5つ星のうち4.6", "co.jp")).toBe(5);
    expect(normaliseNumber("4.6", "co.jp")).toBe(4.6);
  });

  it("reads a french date on the canadian storefront, which serves both languages", () => {
    expect(normaliseDate("Commenté au Canada le 5 janvier 2026", "ca")).toBe("2026-01-05");
  });

  it("reads the indian grouping, where the last three digits group and the rest go in twos", () => {
    expect(normaliseNumber("1,23,456 ratings", "in")).toBe(123456);
    expect(normaliseNumber("12,34,567 ratings", "in")).toBe(1234567);
  });

  it("does not let the indian grouping change how the other marketplaces read", () => {
    expect(normaliseNumber("1,23,456", "com")).toBe(1);
  });

  it("reads a year first date written with western separators too", () => {
    expect(normaliseDate("2026/01/05", "co.jp")).toBe("2026-01-05");
    expect(normaliseDate("2026.1.5", "co.jp")).toBe("2026-01-05");
  });

  it("keeps a day first date day first, and a month first date month first", () => {
    expect(normaliseDate("05/01/2026", "com.au")).toBe("2026-01-05");
    expect(normaliseDate("01/05/2026", "ca")).toBe("2026-01-05");
  });
});
