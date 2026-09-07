import { resolveField } from "./interpreter";
import { normaliseDate, normaliseNumber } from "./normalise";
import type { RulesDocument } from "./rules";
import type { ParsedProductPage } from "./productPage";
import type { ProductSnapshot, Review } from "./types";

// coercion here is generic: no amazon field names, they live in the rules file.
// a bare selector yields one string per element and so cannot be a review source; composite can,
// and it yields the strings the page wrote, which is why every coercion below accepts a string

// an unreadable date becomes null rather than one placed in the wrong month, or a different month
// for every reader's timezone
function coerceReview(value: unknown, locale: string): Review | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    rating: coerceNumber(record.rating, locale),
    text: typeof record.text === "string" ? record.text : null,
    date: typeof record.date === "string" ? normaliseDate(record.date, locale) : null,
    verified: typeof record.verified === "boolean" ? record.verified : null,
    reviewerId: typeof record.reviewerId === "string" ? record.reviewerId : null,
  };
}

// json carries a real number, a selector never does, so only the string needs the locale's separators
function coerceNumber(value: unknown, locale: string): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return typeof value === "string" ? normaliseNumber(value, locale) : null;
}

export function extractReviews(root: ParentNode, rules: RulesDocument, locale: string): Review[] {
  const rule = rules.fields.reviews;
  if (rule === undefined) {
    return [];
  }
  return resolveField(root, rule)
    .map((value) => coerceReview(value, locale))
    .filter((review): review is Review => review !== null);
}

function firstString(root: ParentNode, rules: RulesDocument, field: string): string | null {
  const rule = rules.fields[field];
  if (rule === undefined) {
    return null;
  }
  const matches = resolveField(root, rule);
  const first = matches[0];
  return typeof first === "string" ? first : null;
}

// parseFloat reads "8,043 global ratings" as 8 and "4,6 von 5" as 4
function firstNumber(
  root: ParentNode,
  rules: RulesDocument,
  field: string,
  locale: string,
): number | null {
  const raw = firstString(root, rules, field);
  return raw === null ? null : normaliseNumber(raw, locale);
}

// title has no honest fallback, so it decides whether extraction produced a usable snapshot
export function extractProductSnapshot(
  root: ParentNode,
  rules: RulesDocument,
  page: ParsedProductPage,
  url: string,
): ProductSnapshot | null {
  const title = firstString(root, rules, "title");
  if (title === null) {
    return null;
  }
  return {
    title,
    category: firstString(root, rules, "category"),
    claimedRating: firstNumber(root, rules, "claimedRating", page.locale),
    reviewCount: firstNumber(root, rules, "reviewCount", page.locale),
    site: page.site,
    locale: page.locale,
    url,
    thumbnailUrl: firstString(root, rules, "thumbnailUrl"),
  };
}
