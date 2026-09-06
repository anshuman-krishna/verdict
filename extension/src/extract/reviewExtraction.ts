import { resolveField } from "./interpreter";
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
// PLAN.md's "no amazon specifics in the code, only in the rules file". A
// selector strategy fallback only ever yields strings (one per matched
// element, interpreter.ts's runSelector), which cannot carry five separate
// fields per review, so it is not treated as a review source here; a rules
// document that falls back to selectors for "reviews" degrades to zero
// extracted reviews, the same as an empty or missing field.

function coerceReview(value: unknown): Review | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    rating: typeof record.rating === "number" ? record.rating : null,
    text: typeof record.text === "string" ? record.text : null,
    date: typeof record.date === "string" ? record.date : null,
    verified: typeof record.verified === "boolean" ? record.verified : null,
    reviewerId: typeof record.reviewerId === "string" ? record.reviewerId : null,
  };
}

export function extractReviews(root: ParentNode, rules: RulesDocument): Review[] {
  const rule = rules.fields.reviews;
  if (rule === undefined) {
    return [];
  }
  return resolveField(root, rule)
    .map(coerceReview)
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

function firstNumber(root: ParentNode, rules: RulesDocument, field: string): number | null {
  const raw = firstString(root, rules, field);
  if (raw === null) {
    return null;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isNaN(parsed) ? null : parsed;
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
    claimedRating: firstNumber(root, rules, "claimedRating"),
    reviewCount: firstNumber(root, rules, "reviewCount"),
    site: page.site,
    locale: page.locale,
    url,
    thumbnailUrl: firstString(root, rules, "thumbnailUrl"),
  };
}
