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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableFinite(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return finite(value) ?? undefined;
}

function allPresent(values: readonly (number | null | undefined)[]): boolean {
  return values.every((value) => value !== undefined && value !== null);
}

// a vector read out of a file was written by nobody we can vouch for, and an absent
// feature imputed as zero is a number nobody measured, so a bad one is refused whole
export function parseFeatureVector(value: unknown): FeatureVector | null {
  const record = asRecord(value);
  if (record === null || typeof record.meetsMinimumData !== "boolean") {
    return null;
  }

  const duplication = asRecord(record.textNearDuplication);
  const drift = asRecord(record.listingDrift);
  if (duplication === null || drift === null) {
    return null;
  }

  const clusterCount = finite(duplication.clusterCount);
  const largestClusterShare = finite(duplication.largestClusterShare);
  const offTopicCount = finite(drift.offTopicCount);
  const driftStatistic = finite(drift.driftStatistic);
  const embeddedCount = finite(drift.embeddedCount);
  if (!allPresent([clusterCount, largestClusterShare, offTopicCount, driftStatistic, embeddedCount])) {
    return null;
  }

  const duplicateReviewShare = nullableFinite(duplication.duplicateReviewShare);
  const offTopicShare = nullableFinite(drift.offTopicShare);
  const meanDistance = nullableFinite(drift.meanDistance);
  if (duplicateReviewShare === undefined || offTopicShare === undefined || meanDistance === undefined) {
    return null;
  }

  const rating = parseRatingDeconvolution(record.ratingDeconvolution);
  const burst = parseTemporalBurst(record.temporalBurst);
  const verification = parseVerificationConcentration(record.verificationConcentration);
  const graph = parseReviewerGraph(record.reviewerGraph);
  if (rating === undefined || burst === undefined || verification === undefined || graph === undefined) {
    return null;
  }

  return {
    meetsMinimumData: record.meetsMinimumData,
    ratingDeconvolution: rating,
    temporalBurst: burst,
    verificationConcentration: verification,
    textNearDuplication: {
      duplicateReviewShare,
      clusterCount: clusterCount as number,
      largestClusterShare: largestClusterShare as number,
    },
    listingDrift: {
      offTopicShare,
      offTopicCount: offTopicCount as number,
      meanDistance,
      // nothing reads these back, so they do not cross a file boundary
      changePoint: null,
      driftStatistic: driftStatistic as number,
      embeddedCount: embeddedCount as number,
    },
    reviewerGraph: graph,
  };
}

// undefined means the field was there and unreadable, which fails the whole vector
function parseRatingDeconvolution(value: unknown): RatingDeconvolutionResult | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  const record = asRecord(value);
  const injectedShare = finite(record?.injectedShare);
  const residualError = finite(record?.residualError);
  return allPresent([injectedShare, residualError])
    ? { injectedShare: injectedShare as number, residualError: residualError as number }
    : undefined;
}

function parseTemporalBurst(value: unknown): TemporalBurstResult | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  const record = asRecord(value);
  const burstFraction = finite(record?.burstFraction);
  const burstCount = finite(record?.burstCount);
  const largestBurstShare = finite(record?.largestBurstShare);
  return allPresent([burstFraction, burstCount, largestBurstShare])
    ? {
      bursts: [],
      burstFraction: burstFraction as number,
      burstCount: burstCount as number,
      largestBurstShare: largestBurstShare as number,
    }
    : undefined;
}

function parseVerificationConcentration(
  value: unknown,
): VerificationConcentrationResult | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  const record = asRecord(value);
  const lift = nullableFinite(record?.lift);
  const baseCount = finite(record?.baseCount);
  if (lift === undefined || baseCount === null) {
    return undefined;
  }
  return { lift, baseCount };
}

function parseReviewerGraph(value: unknown): ReviewerGraphResult | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  const record = asRecord(value);
  const flaggedReviewShare = nullableFinite(record?.flaggedReviewShare);
  const flaggedReviewCount = finite(record?.flaggedReviewCount);
  const flaggedReviewerCount = finite(record?.flaggedReviewerCount);
  const knownReviewerCount = finite(record?.knownReviewerCount);
  const identifiedReviewCount = finite(record?.identifiedReviewCount);
  if (
    flaggedReviewShare === undefined ||
    !allPresent([flaggedReviewCount, flaggedReviewerCount, knownReviewerCount, identifiedReviewCount])
  ) {
    return undefined;
  }
  return {
    flaggedReviewShare,
    flaggedReviewCount: flaggedReviewCount as number,
    flaggedReviewerCount: flaggedReviewerCount as number,
    knownReviewerCount: knownReviewerCount as number,
    identifiedReviewCount: identifiedReviewCount as number,
  };
}
