// a reader, never a writer: expectation files are ground truth and written by hand.
// every parse failure is loud. one skipped quietly would shrink the pass rate's denominator, so a
// corpus with half its files broken would score better than a corpus with none

export type Layout = "modern" | "legacy";

const LAYOUTS: readonly string[] = ["modern", "legacy"];

export interface FixtureExpectation {
  // the page this html was saved from. The harness parses site and locale back out of it rather
  // than asking for them twice and risking a pair that disagrees.
  url: string;
  layout: Layout;
  // what the listing claims, read off the page by eye, not the number of
  // reviews the page happens to carry markup for
  reviewCount: number | null;
  claimedRating: number | null;
  // optional, and checked only when present, because a long amazon title retyped by hand is a
  // likelier source of a false failure than the extractor is
  title?: string;
  category?: string;
  // a floor, not an equality: nobody is asked to count review blocks by
  // hand. Absent means the extracted count is reported and not judged.
  minimumExtractedReviews?: number;
  // a documented failure still counts against the pass rate but does not fail the per commit run,
  // so a known gap stays visible instead of being deleted to keep the suite green
  knownFailure?: string;
  notes?: string;
}

export class ExpectationError extends Error {}

export function parseExpectation(name: string, raw: string): FixtureExpectation {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new ExpectationError(`${name}: not valid json (${(error as Error).message})`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ExpectationError(`${name}: expected a json object`);
  }
  const record = data as Record<string, unknown>;

  const url = record.url;
  if (typeof url !== "string" || url === "") {
    throw new ExpectationError(`${name}: "url" is required and must be a non empty string`);
  }
  const layout = record.layout;
  if (typeof layout !== "string" || !LAYOUTS.includes(layout)) {
    throw new ExpectationError(`${name}: "layout" must be one of ${LAYOUTS.join(", ")}`);
  }

  return {
    url,
    layout: layout as Layout,
    reviewCount: requireNullableNumber(name, record, "reviewCount"),
    claimedRating: requireNullableNumber(name, record, "claimedRating"),
    title: optionalString(name, record, "title"),
    category: optionalString(name, record, "category"),
    minimumExtractedReviews: optionalNumber(name, record, "minimumExtractedReviews"),
    knownFailure: optionalString(name, record, "knownFailure"),
    notes: optionalString(name, record, "notes"),
  };
}

// present but null is a real answer (a listing with no rating yet) and is
// kept distinct from absent, which is a file nobody finished.
function requireNullableNumber(
  name: string,
  record: Record<string, unknown>,
  key: string,
): number | null {
  if (!(key in record)) {
    throw new ExpectationError(`${name}: "${key}" is required, use null if the page has none`);
  }
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ExpectationError(`${name}: "${key}" must be a number or null`);
  }
  return value;
}

function optionalString(
  name: string,
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ExpectationError(`${name}: "${key}" must be a string when present`);
  }
  return value;
}

function optionalNumber(
  name: string,
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ExpectationError(`${name}: "${key}" must be a number when present`);
  }
  return value;
}
