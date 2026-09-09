export type Layout = "modern" | "legacy";

const LAYOUTS: readonly string[] = ["modern", "legacy"];

export interface FixtureExpectation {
  url: string;
  layout: Layout;
  reviewCount: number | null;
  claimedRating: number | null;
  title?: string;
  category?: string;
  minimumExtractedReviews?: number;
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
