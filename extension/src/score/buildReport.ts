import type { Review } from "../extract/types";
import { bandFromProbability } from "./band";
import { applyModel, type CombinerModel } from "./combine";
import { buildEvidence } from "./evidence";
import { buildFeatureVector, type FeatureVectorInputs } from "./featureVector";
import { bootstrap, interquartileRange } from "./bootstrap";
import { generateSerial, type Report } from "./report";

export type ReportOutcome =
  // SPEC.md section 13: "extraction yields under 30 reviews: not enough
  // data to judge, no score, no error styling." this also covers the other
  // two SPEC.md section 6 thresholds (dated reviews, history span), which
  // meetsMinimumDataThresholds already folds together.
  | { status: "not-enough-data" }
  // SPEC.md non negotiable 5: never confident on thin data. a model that
  // needs a feature this review set could not produce reports the gap
  // instead of a guess, same as combine.ts's own status.
  | { status: "missing-features"; missing: string[] }
  // no trained model is bundled yet, model.ts's BUNDLED_MODEL is null
  // until PLAN.md week 5. distinct from "not-enough-data": the review set
  // may be perfectly adequate, there is simply nothing to score it with.
  | { status: "no-model" }
  | { status: "ok"; report: Report };

export interface BuildReportOptions {
  reviews: readonly Review[];
  seed: string;
  claimedRating: number;
  model: CombinerModel | null;
  priors: FeatureVectorInputs;
  now?: () => number;
  random?: () => number;
  bootstrapResamples?: number;
}

// SPEC.md 5.1's injectedShare is already defined there as "an interpretable
// estimate of injected share": the natural source for "estimated share of
// reviews that do not look organic" in SPEC.md section 2, distinct from the
// combiner's probability (which answers "how concerning is this listing
// overall", used for the band). when the histogram could not be built at
// all, there is nothing to estimate from, so the share is 0 rather than a
// guess.
function estimatedInorganicShare(vector: ReturnType<typeof buildFeatureVector>): number {
  return vector.ratingDeconvolution?.injectedShare ?? 0;
}

// SPEC.md section 2 says the adjusted rating is "recomputed with suspect
// reviews removed" but does not say which reviews. No signal here scores
// individual reviews, only the review set as a whole, so this applies
// SPEC.md 5.1's own generative assumption backwards: since the injection
// kernel concentrates on four and five stars, the reviews most likely to be
// the injected share are the highest rated ones. This is a proposal, like
// rosette.ts's harmonic mapping, not a ratified reading of that line.
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
  const vector = buildFeatureVector(options.reviews, options.priors);

  if (!vector.meetsMinimumData) {
    return { status: "not-enough-data" };
  }
  if (options.model === null) {
    return { status: "no-model" };
  }

  const result = applyModel(vector, options.model);
  if (result.status === "insufficient-data") {
    return { status: "not-enough-data" };
  }
  if (result.status === "missing-features") {
    return { status: "missing-features", missing: result.missing };
  }

  const model = options.model;
  const samples = bootstrap(
    options.reviews,
    (sample) => {
      const sampleVector = buildFeatureVector(sample, options.priors);
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

  return { status: "ok", report };
}
