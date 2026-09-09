import type { Review } from "../extract/types";
import { bandFromProbability } from "./band";
import { applyModel, selectModel, type ModelSet } from "./combine";
import { buildEvidence } from "./evidence";
import { buildFeatureVector, type FeatureVector, type FeatureVectorInputs } from "./featureVector";
import { bootstrap, interquartileRange } from "./bootstrap";
import { generateSerial, type Report } from "./report";

export type ReportOutcome =
  // SPEC.md section 13, and section 6's dated count and history span thresholds with it
  | { status: "not-enough-data" }
  // a missing feature is reported as a gap, never guessed
  | { status: "missing-features"; missing: string[] }
  // distinct from not-enough-data: the reviews may be fine, there is nothing to score them with
  | { status: "no-model" }
  // SPEC.md section 10 stores the vector too
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
  // SPEC.md 5.4 measures each review against the listing it sits on
  productText?: string;
  // cached reviews carry no text (PRIVACY.md section 2); these keep a cache hit scoring identically
  signatureCache?: WeakMap<Review, bigint[]>;
  embeddingCache?: WeakMap<Review, number[]>;
  // SPEC.md 5.6's input, absent unless the user opted in and the lookup answered
  flaggedReviewerIds?: ReadonlySet<string>;
}

// SPEC.md 5.1's injected share, distinct from the combiner's probability which sets the band
function estimatedInorganicShare(vector: FeatureVector): number {
  return vector.ratingDeconvolution?.injectedShare ?? 0;
}

// no signal scores individual reviews, so this drops the highest rated, per 5.1's injection kernel.
// a proposal, not a ratified reading of section 2
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
  // scoped to this call: priors can be a shared constant, and caching into it would leak signatures
  // from one product into another
  const priors: FeatureVectorInputs = {
    ...options.priors,
    textNearDuplicationSignatureCache: options.signatureCache ?? new WeakMap(),
    textNearDuplicationLinkCache: new WeakMap(),
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

  // picked once, so the bootstrap cannot switch models
  const model = selectModel(options.model, vector);
  const result = applyModel(vector, model);
  if (result.status === "insufficient-data") {
    return { status: "not-enough-data" };
  }
  if (result.status === "missing-features") {
    return { status: "missing-features", missing: result.missing };
  }

  // the caches above keep 200 resamples affordable
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
