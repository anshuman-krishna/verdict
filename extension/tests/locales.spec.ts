// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parseProductUrl, SITES } from "../src/extract/sites";
import { extractProductSnapshot, extractReviews } from "../src/extract/reviewExtraction";
import type { RulesDocument } from "../src/extract/rules";
import { buildReport } from "../src/score/buildReport";
import { meetsMinimumDataThresholds } from "../src/score/featureVector";
import { PLACEHOLDER_PRIORS } from "../src/score/priors";


const RULES: RulesDocument = {
  version: 1,
  site: "amazon",
  locales: ["com", "co.uk", "fr", "de"],
  fields: {
    title: { strategy: "embedded-json", path: "$.title" },
    claimedRating: { strategy: "embedded-json", path: "$.rating" },
    reviewCount: { strategy: "embedded-json", path: "$.reviewCount" },
    reviews: { strategy: "embedded-json", path: "$.reviews[*]" },
  },
};

interface LocaleShape {
  locale: string;
  host: string;
  rating: string;
  reviewCount: string;
  reviewDate: (day: number) => string;
}

const SHAPES: LocaleShape[] = [
  {
    locale: "com",
    host: "www.amazon.com",
    rating: "4.6 out of 5 stars",
    reviewCount: "8,043 global ratings",
    reviewDate: (day) => `Reviewed in the United States on January ${day}, 2026`,
  },
  {
    locale: "co.uk",
    host: "www.amazon.co.uk",
    rating: "4.6 out of 5 stars",
    reviewCount: "8,043 global ratings",
    reviewDate: (day) => `Reviewed in the United Kingdom on ${day} January 2026`,
  },
  {
    locale: "fr",
    host: "www.amazon.fr",
    rating: "4,6 sur 5",
    reviewCount: "8.043 évaluations",
    reviewDate: (day) => `Commenté en France le ${day} janvier 2026`,
  },
  {
    locale: "de",
    host: "www.amazon.de",
    rating: "4,6 von 5 Sternen",
    reviewCount: "8.043 Sternebewertungen",
    reviewDate: (day) => `Rezension aus Deutschland vom ${day}. Januar 2026`,
  },
  {
    locale: "es",
    host: "www.amazon.es",
    rating: "4,6 de 5 estrellas",
    reviewCount: "8.043 valoraciones",
    reviewDate: (day) => `Revisado en España el ${day} de enero de 2026`,
  },
  {
    locale: "it",
    host: "www.amazon.it",
    rating: "4,6 su 5",
    reviewCount: "8.043 recensioni",
    reviewDate: (day) => `Recensito in Italia il ${day} gennaio 2026`,
  },
  {
    locale: "nl",
    host: "www.amazon.nl",
    rating: "4,6 van de 5 sterren",
    reviewCount: "8.043 beoordelingen",
    reviewDate: (day) => `Beoordeeld in Nederland op ${day} januari 2026`,
  },
  {
    locale: "se",
    host: "www.amazon.se",
    rating: "4,6 av 5 stjärnor",
    reviewCount: "8 043 betyg",
    reviewDate: (day) => `Recenserad i Sverige den ${day} januari 2026`,
  },
  {
    locale: "pl",
    host: "www.amazon.pl",
    rating: "4,6 na 5 gwiazdek",
    reviewCount: "8 043 opinii",
    reviewDate: (day) => `Zweryfikowana opinia z Polski z ${day} stycznia 2026`,
  },
  {
    locale: "com.br",
    host: "www.amazon.com.br",
    rating: "4,6 de 5 estrelas",
    reviewCount: "8.043 avaliações",
    reviewDate: (day) => `Avaliado no Brasil em ${day} de janeiro de 2026`,
  },
  {
    locale: "com.mx",
    host: "www.amazon.com.mx",
    rating: "4.6 de 5 estrellas",
    reviewCount: "8,043 calificaciones",
    reviewDate: (day) => `Revisado en México el ${day} de enero de 2026`,
  },
  {
    locale: "ca",
    host: "www.amazon.ca",
    rating: "4.6 out of 5 stars",
    reviewCount: "8,043 global ratings",
    reviewDate: (day) => `Reviewed in Canada on January ${day}, 2026`,
  },
  {
    locale: "com.au",
    host: "www.amazon.com.au",
    rating: "4.6 out of 5 stars",
    reviewCount: "8,043 global ratings",
    reviewDate: (day) => `Reviewed in Australia on ${day} January 2026`,
  },
  {
    locale: "in",
    host: "www.amazon.in",
    rating: "4.6 out of 5 stars",
    reviewCount: "8,043 global ratings",
    reviewDate: (day) => `Reviewed in India on ${day} January 2026`,
  },
  {
    locale: "co.jp",
    host: "www.amazon.co.jp",
    // the japanese sentence opens with the scale, "5つ星のうち4.6", so the rule has to
    // name the node holding the value rather than the sentence around it
    rating: "4.6",
    reviewCount: "8,043件のグローバル評価",
    reviewDate: (day) => `2026年1月${day}日に日本でレビュー済み`,
  },
];

// a locale added to the registry without a shape here would ship unread
describe("the locales this file covers", () => {
  it("covers every locale the registry serves", () => {
    const registered = SITES.flatMap((site) => Object.keys(site.locales)).sort();
    expect(SHAPES.map((shape) => shape.locale).sort()).toEqual(registered);
  });

  it("names the host the registry names, so the url shapes are the real ones", () => {
    for (const shape of SHAPES) {
      const site = SITES.find((entry) => entry.locales[shape.locale] !== undefined);
      expect(site?.locales[shape.locale]?.host).toBe(shape.host);
    }
  });
});

function pageFor(shape: LocaleShape): ParentNode {
  const reviews = Array.from({ length: 30 }, (_unused, index) => ({
    rating: (index % 5) + 1,
    text: `review number ${index} with enough words in it to shingle over`,
    date: shape.reviewDate(index + 1),
    verified: index % 3 !== 0,
    reviewerId: `reviewer-${index}`,
  }));
  const payload = JSON.stringify({
    title: "a product",
    rating: shape.rating,
    reviewCount: shape.reviewCount,
    reviews,
  });
  const container = document.createElement("div");
  container.innerHTML = `<script type="application/ld+json">${payload}</script>`;
  return container;
}

describe.each(SHAPES)("extraction on amazon.$locale", (shape) => {
  const url = `https://${shape.host}/dp/B0LOCALE01`;
  const page = parseProductUrl(url);
  const document = pageFor(shape);

  it("reads the claimed rating as written in this locale", () => {
    const snapshot = extractProductSnapshot(document, RULES, page as NonNullable<typeof page>, url);
    expect(snapshot?.claimedRating).toBe(4.6);
  });

  it("reads the review count as written in this locale", () => {
    const snapshot = extractProductSnapshot(document, RULES, page as NonNullable<typeof page>, url);
    expect(snapshot?.reviewCount).toBe(8043);
  });

  it("normalises every review date to iso", () => {
    const reviews = extractReviews(document, RULES, shape.locale);
    expect(reviews).toHaveLength(30);
    expect(reviews[0]?.date).toBe("2026-01-01");
    expect(reviews[29]?.date).toBe("2026-01-30");
    expect(reviews.every((review) => /^\d{4}-\d{2}-\d{2}$/.test(review.date ?? ""))).toBe(true);
  });

  it("clears the section 6 minimum data thresholds", () => {
    expect(meetsMinimumDataThresholds(extractReviews(document, RULES, shape.locale))).toBe(true);
  });

  it("reaches a real report rather than not enough data", () => {
    const reviews = extractReviews(document, RULES, shape.locale);
    const outcome = buildReport({
      reviews,
      seed: url,
      claimedRating: 4.6,
      model: null,
      priors: PLACEHOLDER_PRIORS,
    });
    expect(outcome.status).toBe("no-model");
  });
});
