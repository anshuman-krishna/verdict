// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parseProductUrl } from "../src/extract/sites";
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
];

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
