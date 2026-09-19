import { MINIMUM_REPORTABLE_DRIFT } from "../score/listingDrift";
import type { WatchReading } from "./reading";

export type WatchChangeKind = "band" | "rating" | "reviews" | "burst" | "drift";

export interface WatchChange {
  kind: WatchChangeKind;
  // band names where the kind is a band, numbers everywhere else
  from: string | number;
  to: string | number;
}

// PROPOSALS.md item 4: these say how much movement is worth telling someone about, which
// makes them thresholds, which makes them yours
export interface WatchThresholds {
  rating: number;
  reviewShare: number;
  reviewFloor: number;
  burst: number;
  drift: number;
}

export const WATCH_THRESHOLDS: WatchThresholds = {
  // one notch of the rating as the panel prints it
  rating: 0.2,
  reviewShare: 0.25,
  reviewFloor: 50,
  burst: 0.1,
  drift: MINIMUM_REPORTABLE_DRIFT,
};

// 4.6 minus 4.4 is not 0.2
const EPSILON = 1e-9;

const BURST = "temporalBurst.largestBurstShare";
const DRIFT = "listingDrift.driftStatistic";

function featureAt(reading: WatchReading, key: string): number | null {
  const value = reading.features?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function compareReadings(
  baseline: WatchReading,
  latest: WatchReading,
  thresholds: WatchThresholds = WATCH_THRESHOLDS,
): WatchChange[] {
  const changes: WatchChange[] = [];

  if (baseline.band !== null && latest.band !== null && baseline.band !== latest.band) {
    changes.push({ kind: "band", from: baseline.band, to: latest.band });
  }

  const wasRated = baseline.adjustedRating;
  const isRated = latest.adjustedRating;
  if (
    wasRated !== null && isRated !== null &&
    Math.abs(isRated - wasRated) >= thresholds.rating - EPSILON
  ) {
    changes.push({ kind: "rating", from: wasRated, to: isRated });
  }

  const wasCount = baseline.totalReviewCount;
  const isCount = latest.totalReviewCount;
  if (wasCount !== null && isCount !== null) {
    const added = isCount - wasCount;
    const worthSaying = Math.max(thresholds.reviewFloor, wasCount * thresholds.reviewShare);
    if (added >= worthSaying) {
      changes.push({ kind: "reviews", from: wasCount, to: isCount });
    }
  }

  const wasBurst = featureAt(baseline, BURST);
  const isBurst = featureAt(latest, BURST);
  if (wasBurst !== null && isBurst !== null && isBurst - wasBurst >= thresholds.burst - EPSILON) {
    changes.push({ kind: "burst", from: wasBurst, to: isBurst });
  }

  // a listing that crossed into reportable drift is one that may have become another listing
  const wasDrift = featureAt(baseline, DRIFT);
  const isDrift = featureAt(latest, DRIFT);
  if (
    wasDrift !== null && isDrift !== null &&
    wasDrift < thresholds.drift && isDrift >= thresholds.drift
  ) {
    changes.push({ kind: "drift", from: wasDrift, to: isDrift });
  }

  return changes;
}
