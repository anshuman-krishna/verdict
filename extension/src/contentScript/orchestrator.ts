import {
  fetchReviewPages,
  NO_REVIEWS_CACHE,
  type FetchProgress,
  type ReviewsCachePort,
} from "../extract/fetchReviewPages";
import { extractProductSnapshot, extractReviews } from "../extract/reviewExtraction";
import { mergeReviews } from "../extract/reviewIdentity";
import { parseProductUrl, reviewPageUrl, type ParsedProductPage } from "../extract/sites";
import type { RulesDocument } from "../extract/rules";
import type { ProductSnapshot, Review } from "../extract/types";
import { buildContributionEdge, type ContributionEdge } from "../graph/edge";
import { lookupFlaggedReviewers } from "../reputation/client";
import { buildReport, type ReportOutcome } from "../score/buildReport";
import type { FeatureVector } from "../score/featureVector";
import { signalsFor, type ModelSet } from "../score/combine";
import type { FeatureVectorInputs } from "../score/featureVector";

export interface ReputationLookupDeps {
  isEnabled: () => Promise<boolean>;
  endpoint: string;
  salt: string;
  fetchImpl?: typeof fetch;
  random?: () => number;
  delay?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  budgetMs?: number;
}

export interface OrchestratorDeps {
  rules: RulesDocument;
  model: ModelSet | null;
  priors: FeatureVectorInputs;
  isHistoryEnabled: () => Promise<boolean>;
  saveHistory: (
    entry: {
      title: string;
      thumbnailUrl: string | null;
      report: unknown;
      featureVector: FeatureVector;
    },
  ) => Promise<unknown>;
  now?: () => number;
  random?: () => number;
  bootstrapResamples?: number;
  reputation?: ReputationLookupDeps;
  graphContribution?: GraphContributionDeps;
}

export interface GraphContributionDeps {
  isEnabled: () => Promise<boolean>;
  salt: string;
  enqueue: (edges: readonly ContributionEdge[]) => Promise<void>;
}

export interface AnalysisResult {
  page: ParsedProductPage;
  product: ProductSnapshot;
  reviews: Review[];
  outcome: ReportOutcome;
}

const REVIEWER_NETWORK = signalsFor(["reviewerGraph"]);

export interface AnalysisStage {
  result: AnalysisResult;
  pending: string[];
}

export interface AnalyzeOptions {
  onRecognised?: (page: ParsedProductPage) => void;
  onStage?: (stage: AnalysisStage) => void;
}

export async function analyzePage(
  document: ParentNode,
  url: string,
  deps: OrchestratorDeps,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult | null> {
  const page = parseProductUrl(url);
  if (page === null) {
    return null;
  }
  const product = extractProductSnapshot(document, deps.rules, page, url);
  if (product === null) {
    return null;
  }
  options.onRecognised?.(page);
  const reviews = extractReviews(document, deps.rules, page.locale);
  const outcome = await scoreAndMaybeSave(page, product, reviews, deps, options);
  const result = { page, product, reviews, outcome };
  options.onStage?.({ result, pending: [] });
  return result;
}

async function bestEffort(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch {
    return;
  }
}

function productText(product: ProductSnapshot): string {
  return product.category === null ? product.title : `${product.title} ${product.category}`;
}

async function scoreAndMaybeSave(
  page: ParsedProductPage,
  product: ProductSnapshot,
  reviews: readonly Review[],
  deps: OrchestratorDeps,
  options: AnalyzeOptions = {},
  signatureCache?: WeakMap<Review, bigint[]>,
  embeddingCache?: WeakMap<Review, number[]>,
): Promise<ReportOutcome> {
  if (product.claimedRating === null) {
    return { status: "not-enough-data" };
  }

  // reused by both passes
  const signatures = signatureCache ?? new WeakMap<Review, bigint[]>();
  const embeddings = embeddingCache ?? new WeakMap<Review, number[]>();
  const score = (flaggedReviewerIds?: ReadonlySet<string>): ReportOutcome =>
    buildReport({
      reviews,
      seed: product.url,
      claimedRating: product.claimedRating as number,
      productText: productText(product),
      model: deps.model,
      priors: deps.priors,
      now: deps.now,
      random: deps.random,
      bootstrapResamples: deps.bootstrapResamples,
      signatureCache: signatures,
      embeddingCache: embeddings,
      flaggedReviewerIds,
    });

  const lookingUp = deps.reputation !== undefined && (await deps.reputation.isEnabled());
  if (lookingUp) {
    const provisional = score();
    options.onStage?.({
      result: { page, product, reviews: [...reviews], outcome: provisional },
      pending: REVIEWER_NETWORK,
    });
  }

  const flaggedReviewerIds = lookingUp
    ? await flaggedReviewers(reviews, deps.reputation as ReputationLookupDeps)
    : undefined;
  const outcome = score(flaggedReviewerIds);

  if (outcome.status === "ok") {
    // a failed write must not discard a report
    await bestEffort(async () => {
      if (deps.graphContribution && (await deps.graphContribution.isEnabled())) {
        await queueGraphContribution(page, reviews, deps.graphContribution);
      }
    });
    await bestEffort(async () => {
      if (await deps.isHistoryEnabled()) {
        await deps.saveHistory({
          title: product.title,
          thumbnailUrl: product.thumbnailUrl,
          report: outcome.report,
          featureVector: outcome.featureVector,
        });
      }
    });
  }

  return outcome;
}

async function queueGraphContribution(
  page: ParsedProductPage,
  reviews: readonly Review[],
  graphContribution: GraphContributionDeps,
): Promise<void> {
  const edges = await Promise.all(
    reviews.map((review) => buildContributionEdge(review, page.productId, graphContribution.salt)),
  );
  const built = edges.filter((edge): edge is ContributionEdge => edge !== null);
  if (built.length > 0) {
    await graphContribution.enqueue(built);
  }
}

async function flaggedReviewers(
  reviews: readonly Review[],
  reputation: ReputationLookupDeps,
): Promise<Set<string>> {
  const reviewerIds = reviews
    .map((review) => review.reviewerId)
    .filter((id): id is string => id !== null);
  return lookupFlaggedReviewers(reviewerIds, {
    endpoint: reputation.endpoint,
    salt: reputation.salt,
    fetchImpl: reputation.fetchImpl,
    random: reputation.random,
    delay: reputation.delay,
    timeoutMs: reputation.timeoutMs,
    budgetMs: reputation.budgetMs,
  });
}

export { mergeReviews };

export interface CheckMoreDeeplyOptions {
  maxPages?: number;
  fetchImpl?: typeof fetch;
  delay?: (ms: number) => Promise<void>;
  random?: () => number;
  onProgress?: (progress: FetchProgress) => void;
  cache: ReviewsCachePort;
}

export async function checkMoreDeeply(
  page: ParsedProductPage,
  product: ProductSnapshot,
  existingReviews: readonly Review[],
  deps: OrchestratorDeps,
  options: CheckMoreDeeplyOptions = { cache: NO_REVIEWS_CACHE },
): Promise<AnalysisResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetched = await fetchReviewPages({
    productId: page.productId,
    site: page.site,
    maxPages: options.maxPages,
    delay: options.delay,
    random: options.random,
    onProgress: options.onProgress,
    cache: options.cache ?? NO_REVIEWS_CACHE,
    fetchPage: async (pageNumber) => {
      const response = await fetchImpl(reviewPageUrl(page, pageNumber));
      if (!response.ok) {
        return [];
      }
      const html = await response.text();
      const parsed = new DOMParser().parseFromString(html, "text/html");
      return extractReviews(parsed, deps.rules, page.locale);
    },
  });

  const reviews = mergeReviews(existingReviews, fetched.reviews);
  const outcome = await scoreAndMaybeSave(
    page,
    product,
    reviews,
    deps,
    {},
    fetched.signatures,
    fetched.embeddings,
  );
  return { page, product, reviews, outcome };
}
