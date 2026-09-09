import type { Review } from "../extract/types";
import { bandFromProbability } from "./band";
import { applyModel, selectModel, type ModelSet } from "./combine";
import { buildEvidence } from "./evidence";
import { buildFeatureVector, type FeatureVector, type FeatureVectorInputs } from "./featureVector";
import { bootstrap, interquartileRange } from "./bootstrap";
import { generateSerial, type Report } from "./report";

export type ReportOutcome =
  | { status: "not-enough-data" }
  | { status: "missing-features"; missing: string[] }
  | { status: "no-model" }
  | { status: "ok"; report: Report; featureVector: FeatureVector };

export interface BuildReportOptions {
  reviews: readonly Review[];
  seed: string;
  claimedRating: number;
  model: ModelSet | null;
  priors: FeatureVectorInputs;
  now?: () => number;
  random?: () => number;
  bootstrapResamples?: number;
  productText?: string;
  signatureCache?: WeakMap<Review, bigint[]>;
  embeddingCache?: WeakMap<Review, number[]>;
  flaggedReviewerIds?: ReadonlySet<string>;
}

function estimatedInorganicShare(vector: FeatureVector): number {
  return vector.ratingDeconvolution?.injectedShare ?? 0;
}

function adjustedRating(reviews: readonly Review[], claimedRating: number, excludedCount: number): number {
  const rated = reviews.filter((review): review is Review & { rating: number } => review.rating !== null);
  if (rated.length === 0 || excludedCount === 0) {
    return claimedRating;
  }
  const kept = [...rated].sort((a, b) => b.rating - a.rating).slice(excludedCount);
  if (kept.length === 0) {
    return claimedRating;
  }
  const total = kept.reduce((sum, review) => sum + review.rating, 0);
  return total / kept.length;
}

export function buildReport(options: BuildReportOptions): ReportOutcome {
  const now = options.now ?? Date.now;
  const priors: FeatureVectorInputs = {
    ...options.priors,
    textNearDuplicationSignatureCache: options.signatureCache ?? new WeakMap(),
    textNearDuplicationLinkCache: new WeakMap(),
    // scoped, so caches never cross products
    listingDriftEmbeddingCache: options.embeddingCache ?? new WeakMap(),
    productText: options.productText ?? "",
    flaggedReviewerIds: options.flaggedReviewerIds,
  };
  const vector = buildFeatureVector(options.reviews, priors);

  if (!vector.meetsMinimumData) {
    return { status: "not-enough-data" };
  }
  if (options.model === null) {
    return { status: "no-model" };
  }

  // picked once, so resamples cannot switch
  const model = selectModel(options.model, vector);
  const result = applyModel(vector, model);
  if (result.status === "insufficient-data") {
    return { status: "not-enough-data" };
  }
  if (result.status === "missing-features") {
    return { status: "missing-features", missing: result.missing };
  }

  const samples = bootstrap(
    options.reviews,
    (sample) => {
      const sampleVector = buildFeatureVector(sample, priors);
      const sampleResult = applyModel(sampleVector, model);
      return sampleResult.status === "ok" ? sampleResult.probability : null;
    },
    { resamples: options.bootstrapResamples, random: options.random },
  ).filter((value): value is number => value !== null);
  const confidence = samples.length > 0
    ? interquartileRange(samples)
    : { low: result.probability, high: result.probability };

  const inorganicShare = estimatedInorganicShare(vector);
  const excludedReviewCount = Math.min(
    options.reviews.length,
    Math.round(inorganicShare * options.reviews.length),
  );
  const generatedAt = now();

  const report: Report = {
    serial: generateSerial(options.seed, generatedAt),
    band: bandFromProbability(result.probability),
    claimedRating: options.claimedRating,
    adjustedRating: adjustedRating(options.reviews, options.claimedRating, excludedReviewCount),
    totalReviewCount: options.reviews.length,
    excludedReviewCount,
    estimatedInorganicShare: inorganicShare,
    confidence,
    evidence: buildEvidence(vector),
    generatedAt,
  };

  return { status: "ok", report, featureVector: vector };
}
