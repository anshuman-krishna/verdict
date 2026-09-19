import { flattenFeatureVector, type FlatFeatures } from "../score/combine";
import type { FeatureVector } from "../score/featureVector";
import type { Band, Report } from "../score/report";

// what a later check is compared against. the reading, not the report, because a watchlist
// that stored whole reports would be a second history
export interface WatchReading {
  at: number;
  band: Band | null;
  probability: number | null;
  claimedRating: number | null;
  adjustedRating: number | null;
  totalReviewCount: number | null;
  features: FlatFeatures | null;
}

export function readingFromReport(
  report: Report,
  featureVector?: FeatureVector,
): WatchReading {
  return {
    at: report.generatedAt,
    band: report.band,
    probability: report.probability,
    claimedRating: report.claimedRating,
    adjustedRating: report.adjustedRating,
    totalReviewCount: report.totalReviewCount,
    features: featureVector === undefined ? null : flattenFeatureVector(featureVector),
  };
}

function numberOr(value: unknown, fallback: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function parseReading(value: unknown): WatchReading | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const at = numberOr(record.at, null);
  if (at === null) {
    return null;
  }
  return {
    at,
    band: typeof record.band === "string" ? (record.band as Band) : null,
    probability: numberOr(record.probability, null),
    claimedRating: numberOr(record.claimedRating, null),
    adjustedRating: numberOr(record.adjustedRating, null),
    totalReviewCount: numberOr(record.totalReviewCount, null),
    features: parseFeatures(record.features),
  };
}

function parseFeatures(value: unknown): FlatFeatures | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const parsed: FlatFeatures = {};
  for (const [key, entry] of Object.entries(value)) {
    parsed[key] = numberOr(entry, null);
  }
  return parsed;
}
