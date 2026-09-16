import { resolveFieldTraced, type StrategyTrace } from "./interpreter";
import { normaliseDate, normaliseNumber } from "./normalise";
import type { NumberFormat, RulesDocument } from "./rules";
import type { ParsedProductPage } from "./sites";
import { safeThumbnailUrl } from "./sites";
import type { ProductSnapshot, Review } from "./types";


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

function coerceNumber(value: unknown, locale: string): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return typeof value === "string" ? normaliseNumber(value, locale) : null;
}

// the one locale whose number format is the machine format
const MACHINE_NUMBER_LOCALE = "com";

function numberLocale(trace: readonly StrategyTrace[], locale: string): string {
  const format: NumberFormat = trace[trace.length - 1]?.format ?? "locale";
  return format === "machine" ? MACHINE_NUMBER_LOCALE : locale;
}

export function extractReviews(root: ParentNode, rules: RulesDocument, locale: string): Review[] {
  const rule = rules.fields.reviews;
  if (rule === undefined) {
    return [];
  }
  const { values, trace } = resolveFieldTraced(root, rule);
  const readAs = numberLocale(trace, locale);
  return values
    .map((value) => coerceReview(value, readAs))
    .filter((review): review is Review => review !== null);
}

function firstString(root: ParentNode, rules: RulesDocument, field: string): string | null {
  const rule = rules.fields[field];
  if (rule === undefined) {
    return null;
  }
  // a match list can open with a shape this field cannot use, which does not end it
  const matches = resolveFieldTraced(root, rule).values;
  return matches.find((value): value is string => typeof value === "string") ?? null;
}

function firstNumber(
  root: ParentNode,
  rules: RulesDocument,
  field: string,
  locale: string,
): number | null {
  const rule = rules.fields[field];
  if (rule === undefined) {
    return null;
  }
  const { values, trace } = resolveFieldTraced(root, rule);
  const readAs = numberLocale(trace, locale);
  for (const value of values) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    const parsed = typeof value === "string" ? normaliseNumber(value, readAs) : null;
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

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
    thumbnailUrl: safeThumbnailUrl(firstString(root, rules, "thumbnailUrl")),
  };
}
