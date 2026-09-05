import type { Review } from "../extract/types";
import { ratingDeconvolution, type RatingDeconvolutionResult } from "./ratingDeconvolution";
import { detectTemporalBursts, type Burst, type TemporalBurstResult } from "./temporalBurst";
import { textNearDuplication, type TextNearDuplicationResult } from "./textNearDuplication";
import {
  verificationConcentration,
  type VerificationConcentrationResult,
} from "./verificationConcentration";

// SPEC.md section 6, "minimum data thresholds". below any of these the
// report says "not enough data" and shows no score at all.
export const MINIMUM_REVIEW_COUNT = 30;
export const MINIMUM_DATED_REVIEW_COUNT = 20;
export const MINIMUM_HISTORY_DAYS = 21;

const MS_PER_DAY = 86_400_000;

// a zone-less datetime string ("2024-03-15T10:00:00") parses as local time
// per the date spec, while a date-only string ("2024-03-15") parses as utc
// midnight. that split would make this function's output depend on the
// machine's timezone, so a datetime with a time component must carry an
// explicit "Z" or offset, and anything else is rejected rather than guessed.
export function dayIndex(iso: string): number {
  const hasTimeComponent = iso.includes("T");
  const hasExplicitZone = /Z|[+-]\d{2}:\d{2}$/.test(iso);
  if (hasTimeComponent && !hasExplicitZone) {
    throw new Error(`dayIndex requires an explicit time zone on a datetime string: ${iso}`);
  }
  return Math.floor(Date.parse(iso) / MS_PER_DAY);
}

export function meetsMinimumDataThresholds(reviews: readonly Review[]): boolean {
  if (reviews.length < MINIMUM_REVIEW_COUNT) {
    return false;
  }
  const datedDays = reviews
    .filter((review): review is Review & { date: string } => review.date !== null)
    .map((review) => dayIndex(review.date));
  if (datedDays.length < MINIMUM_DATED_REVIEW_COUNT) {
    return false;
  }
  const span = Math.max(...datedDays) - Math.min(...datedDays);
  return span >= MINIMUM_HISTORY_DAYS;
}

// buckets star ratings 1 through 5 into proportions, matching the five bin
// convention ratingDeconvolution's organicPrior and injectionKernel use.
// null when no review carries a rating at all.
export function buildRatingHistogram(reviews: readonly Review[]): number[] | null {
  const rated = reviews.filter((review): review is Review & { rating: number } =>
    review.rating !== null
  );
  if (rated.length === 0) {
    return null;
  }
  const bins = [0, 0, 0, 0, 0];
  for (const review of rated) {
    const bin = Math.min(5, Math.max(1, Math.round(review.rating))) - 1;
    bins[bin] = (bins[bin] ?? 0) + 1;
  }
  return bins.map((count) => count / rated.length);
}

export interface DailyCounts {
  dailyCounts: number[];
  minDay: number;
}

// a dense, gap filled daily series, day 0 being the earliest dated review,
// which is what detectTemporalBursts expects. null when no review is dated.
export function buildDailyCounts(reviews: readonly Review[]): DailyCounts | null {
  const days = reviews
    .filter((review): review is Review & { date: string } => review.date !== null)
    .map((review) => dayIndex(review.date));
  if (days.length === 0) {
    return null;
  }
  const minDay = Math.min(...days);
  const maxDay = Math.max(...days);
  const dailyCounts = new Array<number>(maxDay - minDay + 1).fill(0);
  for (const day of days) {
    const index = day - minDay;
    dailyCounts[index] = (dailyCounts[index] ?? 0) + 1;
  }
  return { dailyCounts, minDay };
}

// whether each review's date falls inside one of the given bursts. a review
// with no date is never inside a burst, since it has no day to place it in.
export function deriveInsideBurst(
  reviews: readonly Review[],
  minDay: number,
  bursts: readonly Burst[],
): boolean[] {
  return reviews.map((review) => {
    if (review.date === null) {
      return false;
    }
    const day = dayIndex(review.date) - minDay;
    return bursts.some((burst) => day >= burst.startDay && day <= burst.endDay);
  });
}

export interface FeatureVectorInputs {
  // per SPEC.md 5.1, estimated per product category from the negative
  // corpus, which does not exist yet. supplied by the caller rather than
  // computed here.
  organicPrior: readonly number[];
  injectionKernel: readonly number[];
  windowDays?: number;
  percentile?: number;
}

export interface FeatureVector {
  meetsMinimumData: boolean;
  ratingDeconvolution: RatingDeconvolutionResult | null;
  temporalBurst: TemporalBurstResult | null;
  verificationConcentration: VerificationConcentrationResult | null;
  textNearDuplication: TextNearDuplicationResult;
}

// wires the four implemented signals against raw extracted reviews. the
// combiner that turns this into a probability and a band does not exist
// yet, that is SPEC.md section 6 and it waits on ground truth.
export function buildFeatureVector(
  reviews: readonly Review[],
  inputs: FeatureVectorInputs,
): FeatureVector {
  const meetsMinimumData = meetsMinimumDataThresholds(reviews);

  const histogram = buildRatingHistogram(reviews);
  const ratingResult = histogram !== null
    ? ratingDeconvolution(histogram, inputs.organicPrior, inputs.injectionKernel)
    : null;

  const daily = buildDailyCounts(reviews);
  const temporalResult = daily !== null
    ? detectTemporalBursts(daily.dailyCounts, inputs.windowDays, inputs.percentile)
    : null;

  let verificationResult: VerificationConcentrationResult | null = null;
  if (daily !== null && temporalResult !== null) {
    const insideBurst = deriveInsideBurst(reviews, daily.minDay, temporalResult.bursts);
    verificationResult = verificationConcentration(
      reviews.map((review, i) => ({
        rating: review.rating,
        verified: review.verified,
        insideBurst: insideBurst[i] ?? false,
      })),
    );
  }

  const duplicationResult = textNearDuplication(reviews.map((review) => ({ text: review.text })));

  return {
    meetsMinimumData,
    ratingDeconvolution: ratingResult,
    temporalBurst: temporalResult,
    verificationConcentration: verificationResult,
    textNearDuplication: duplicationResult,
  };
}
