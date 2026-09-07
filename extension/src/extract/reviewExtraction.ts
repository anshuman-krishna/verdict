import { resolveField } from "./interpreter";
import { normaliseDate, normaliseNumber } from "./normalise";
import type { RulesDocument } from "./rules";
import type { ParsedProductPage } from "./productPage";
import type { ProductSnapshot, Review } from "./types";

// interpreter.ts stays untouched here on purpose (PLAN.md flags the
// extraction interpreter as one of the two places accumulated session
// context most easily produces plausible wrong code). This module only
// consumes what resolveField already returns.
//
// The embedded-json strategy resolves a JSONPath match to the raw parsed
// json value at that path (interpreter.test.ts's first case: a wildcard
// path over an array of objects yields those objects directly). SPEC.md's
// own rules.json example targets "$.reviewsData.reviews[*]" for exactly
// this reason: a rules document written against real amazon markup is
// expected to point at a location whose objects already carry rating/
// text/date/verified/reviewerId keys, matching the Review shape below.
// Coercion here is generic and does not know amazon's field names, per
// PLAN.md's "no amazon specifics in the code, only in the rules file".
//
// A plain selector strategy yields one string per matched element
// (interpreter.ts's runSelector), which cannot carry five fields per
// review, so it is still not a review source: a rules document falling back
// to a bare selector for "reviews" extracts nothing. The composite strategy
// beside it is what SPEC.md section 9's own fallback example needs, and it
// yields a record per review block whose values are the strings the page
// wrote, which is why every coercion below accepts a string as readily as a
// parsed json value.

// a rating and a date can each arrive as the page wrote them, so both go
// through extract/normalise.ts. A date that cannot be read becomes null
// rather than a string score/featureVector.ts would place in the wrong
// month, or in a different month for every reader's timezone.
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

// an embedded json block usually carries a real number, and a selector
// fallback never does, so both are accepted and only the string goes
// through the locale's separators.
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

// parseFloat would read amazon's own "8,043 global ratings" as 8 and
// ".de"'s "4,6 von 5" as 4, so the locale decides which separator is which
// (extract/normalise.ts).
function firstNumber(
  root: ParentNode,
  rules: RulesDocument,
  field: string,
  locale: string,
): number | null {
  const raw = firstString(root, rules, field);
  return raw === null ? null : normaliseNumber(raw, locale);
}

// title is the one field with no honest fallback: an untitled report is
// worse than none, so this is the field that decides whether extraction
// produced a usable snapshot at all.
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
