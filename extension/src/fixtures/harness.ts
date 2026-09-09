import { resolveFieldTraced, type StrategyTrace } from "../extract/interpreter";
import { parseProductUrl } from "../extract/sites";
import { extractProductSnapshot, extractReviews } from "../extract/reviewExtraction";
import type { RulesDocument } from "../extract/rules";
import type { FixtureExpectation, Layout } from "./expectation";


const RATING_TOLERANCE = 1e-6;

export interface FieldCheck {
  field: string;
  expected: unknown;
  actual: unknown;
  ok: boolean;
  strategies: StrategyTrace[] | null;
}

export interface FixtureResult {
  name: string;
  site: string;
  locale: string;
  layout: Layout;
  ok: boolean;
  knownFailure: string | null;
  extractedReviews: number;
  checks: FieldCheck[];
}

export class FixtureError extends Error {}

export function runFixture(
  name: string,
  document: ParentNode,
  expectation: FixtureExpectation,
  rules: RulesDocument,
): FixtureResult {
  const page = parseProductUrl(expectation.url);
  if (page === null) {
    throw new FixtureError(`${name}: "url" is not a product url this build can parse`);
  }

  const snapshot = extractProductSnapshot(document, rules, page, expectation.url);
  const reviews = extractReviews(document, rules, page.locale);
  const base = {
    name,
    site: page.site,
    locale: page.locale,
    layout: expectation.layout,
    knownFailure: expectation.knownFailure ?? null,
    extractedReviews: reviews.length,
  };

  if (snapshot === null) {
    const check = failedCheck("title", expectation.title ?? "any non empty title", null, document, rules);
    return { ...base, ok: false, checks: [check] };
  }

  const checks: FieldCheck[] = [];
  const record = (field: string, expected: unknown, actual: unknown, ok: boolean): void => {
    checks.push({
      field,
      expected,
      actual,
      ok,
      strategies: ok ? null : traceOf(document, rules, field),
    });
  };

  const expectedTitle = expectation.title;
  if (expectedTitle !== undefined) {
    record("title", expectedTitle, snapshot.title, equalStrings(expectedTitle, snapshot.title));
  }
  const expectedCategory = expectation.category;
  if (expectedCategory !== undefined) {
    record(
      "category",
      expectedCategory,
      snapshot.category,
      equalStrings(expectedCategory, snapshot.category),
    );
  }
  record(
    "claimedRating",
    expectation.claimedRating,
    snapshot.claimedRating,
    equalRatings(expectation.claimedRating, snapshot.claimedRating),
  );
  record(
    "reviewCount",
    expectation.reviewCount,
    snapshot.reviewCount,
    expectation.reviewCount === snapshot.reviewCount,
  );
  const floor = expectation.minimumExtractedReviews;
  if (floor !== undefined) {
    record("reviews", `at least ${floor}`, reviews.length, reviews.length >= floor);
  }

  return { ...base, ok: checks.every((check) => check.ok), checks };
}

function failedCheck(
  field: string,
  expected: unknown,
  actual: unknown,
  document: ParentNode,
  rules: RulesDocument,
): FieldCheck {
  return { field, expected, actual, ok: false, strategies: traceOf(document, rules, field) };
}

function traceOf(document: ParentNode, rules: RulesDocument, field: string): StrategyTrace[] {
  const rule = rules.fields[field];
  if (rule === undefined) {
    return [];
  }
  return resolveFieldTraced(document, rule).trace;
}

function equalStrings(expected: string, actual: string | null): boolean {
  return actual !== null && actual.trim() === expected.trim();
}

function equalRatings(expected: number | null, actual: number | null): boolean {
  if (expected === null || actual === null) {
    return expected === actual;
  }
  return Math.abs(expected - actual) <= RATING_TOLERANCE;
}
