import type { Review } from "../extract/types";
import {
  listingIdentityDrift,
  type ListingDriftOptions,
  type ListingDriftResult,
} from "./listingDrift";
import { ratingDeconvolution, type RatingDeconvolutionResult } from "./ratingDeconvolution";
import { reviewerGraphShare, type ReviewerGraphResult } from "./reviewerGraph";
import { detectTemporalBursts, type Burst, type TemporalBurstResult } from "./temporalBurst";
import {
  textNearDuplication,
  type TextNearDuplicationOptions,
  type TextNearDuplicationResult,
} from "./textNearDuplication";
import {
  verificationConcentration,
  type VerificationConcentrationResult,
} from "./verificationConcentration";

// SPEC.md section 6 minimum data thresholds
export const MINIMUM_REVIEW_COUNT = 30;
export const MINIMUM_DATED_REVIEW_COUNT = 20;
export const MINIMUM_HISTORY_DAYS = 21;

const MS_PER_DAY = 86_400_000;

// a zoneless date parses per reader
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/;

export function dayIndex(iso: string): number {
  if (!ISO_DATE_ONLY.test(iso) && !ISO_DATETIME_WITH_ZONE.test(iso)) {
    throw new Error(`dayIndex requires an iso date with no ambiguous zone: ${iso}`);
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

export function deriveDayIndices(reviews: readonly Review[]): (number | null)[] {
  return reviews.map((review) => (review.date === null ? null : dayIndex(review.date)));
}

export interface DailyCounts {
  dailyCounts: number[];
  minDay: number;
}

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
  organicPrior: readonly number[];
  injectionKernel: readonly number[];
  windowDays?: number;
  percentile?: number;
  textNearDuplicationSignatureCache?: TextNearDuplicationOptions["signatureCache"];
  textNearDuplicationLinkCache?: TextNearDuplicationOptions["linkCache"];
  productText?: string;
  listingDriftEmbeddingCache?: ListingDriftOptions["embeddingCache"];
  flaggedReviewerIds?: ReadonlySet<string>;
}

export interface FeatureVector {
  meetsMinimumData: boolean;
  ratingDeconvolution: RatingDeconvolutionResult | null;
  temporalBurst: TemporalBurstResult | null;
  verificationConcentration: VerificationConcentrationResult | null;
  textNearDuplication: TextNearDuplicationResult;
  listingDrift: ListingDriftResult;
  reviewerGraph: ReviewerGraphResult | null;
}

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

  const duplicationResult = textNearDuplication(reviews, {
    signatureCache: inputs.textNearDuplicationSignatureCache,
    linkCache: inputs.textNearDuplicationLinkCache,
  });

  const driftResult = listingIdentityDrift(
    reviews,
    deriveDayIndices(reviews),
    inputs.productText ?? "",
    { embeddingCache: inputs.listingDriftEmbeddingCache },
  );

  const reviewerGraphResult = inputs.flaggedReviewerIds !== undefined
    ? reviewerGraphShare(reviews, inputs.flaggedReviewerIds)
    : null;

  return {
    meetsMinimumData,
    ratingDeconvolution: ratingResult,
    temporalBurst: temporalResult,
    verificationConcentration: verificationResult,
    textNearDuplication: duplicationResult,
    listingDrift: driftResult,
    reviewerGraph: reviewerGraphResult,
  };
}
