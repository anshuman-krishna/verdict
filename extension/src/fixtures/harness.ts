import { resolveFieldTraced, type StrategyTrace } from "../extract/interpreter";
import { parseAmazonProductUrl } from "../extract/productPage";
import { extractProductSnapshot, extractReviews } from "../extract/reviewExtraction";
import type { RulesDocument } from "../extract/rules";
import type { FixtureExpectation, Layout } from "./expectation";

// PLAN.md week 1 task 6: "a test that loads every fixture, runs extraction, and compares against
// the hand written expectations. Report per fixture, with failures naming the field and the
// strategy that ran", and its verify line: "a deliberately broken selector shows up as a failure
// rather than as a silent empty result".
//
// so this runs the production path (extractProductSnapshot and extractReviews, the same two
// functions the content script calls) for the values, and re-walks the rule only for a field that
// failed, to say which strategy produced the wrong answer or which one found nothing.

// claimed ratings are one decimal place on the page and arrive here through parseFloat, so this is
// float noise tolerance, not a judgement about how close is close enough.
const RATING_TOLERANCE = 1e-6;

export interface FieldCheck {
  field: string;
  expected: unknown;
  actual: unknown;
  ok: boolean;
  // only populated for a failing check
  strategies: StrategyTrace[] | null;
}

export interface FixtureResult {
  name: string;
  site: string;
  locale: string;
  layout: Layout;
  ok: boolean;
  // the reason from the expectation file when this fixture is a documented
  // gap, null when it is expected to pass
  knownFailure: string | null;
  // reported always, judged only when the expectation sets a floor
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
  const page = parseAmazonProductUrl(expectation.url);
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

  // reviewExtraction returns null only when title found nothing, and every
  // other field is beside the point once the page did not identify itself.
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

// an empty trace means the rules document has no rule for this field at all, which report.ts
// renders differently from "every strategy ran and matched nothing". Conflating the two is how a
// missing rule reads as a broken page.
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
