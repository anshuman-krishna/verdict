import { resolveFieldTraced, type StrategyTrace } from "./interpreter";
import { newPageIndex, type PageIndex } from "./structuredData";
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

export function extractReviews(
  root: ParentNode,
  rules: RulesDocument,
  locale: string,
  index: PageIndex = newPageIndex(),
): Review[] {
  const rule = rules.fields.reviews;
  if (rule === undefined) {
    return [];
  }
  const { values, trace } = resolveFieldTraced(root, rule, index);
  const readAs = numberLocale(trace, locale);
  return values
    .map((value) => coerceReview(value, readAs))
    .filter((review): review is Review => review !== null);
}

function stringField(
  root: ParentNode,
  rules: RulesDocument,
  field: string,
  index: PageIndex,
): string | null {
  const rule = rules.fields[field];
  if (rule === undefined) {
    return null;
  }
  const { values, trace } = resolveFieldTraced(root, rule, index);
  // a match list can open with a shape this field cannot use, which does not end it
  const strings = values.filter((value): value is string => typeof value === "string");
  const join = trace[trace.length - 1]?.join;
  if (join !== undefined && strings.length > 0) {
    return strings.join(join);
  }
  return strings[0] ?? null;
}

function firstNumber(
  root: ParentNode,
  rules: RulesDocument,
  field: string,
  locale: string,
  index: PageIndex,
): number | null {
  const rule = rules.fields[field];
  if (rule === undefined) {
    return null;
  }
  const { values, trace } = resolveFieldTraced(root, rule, index);
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
  index: PageIndex = newPageIndex(),
): ProductSnapshot | null {
  const title = stringField(root, rules, "title", index);
  if (title === null) {
    return null;
  }
  return {
    title,
    category: stringField(root, rules, "category", index),
    claimedRating: firstNumber(root, rules, "claimedRating", page.locale, index),
    reviewCount: firstNumber(root, rules, "reviewCount", page.locale, index),
    site: page.site,
    locale: page.locale,
    url,
    thumbnailUrl: safeThumbnailUrl(stringField(root, rules, "thumbnailUrl", index)),
  };
}
