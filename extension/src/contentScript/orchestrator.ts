import { fetchReviewPages, type FetchProgress } from "../extract/fetchReviewPages";
import { extractProductSnapshot, extractReviews } from "../extract/reviewExtraction";
import { parseProductUrl, reviewPageUrl, type ParsedProductPage } from "../extract/sites";
import type { RulesDocument } from "../extract/rules";
import type { ProductSnapshot, Review } from "../extract/types";
import { buildContributionEdge, type ContributionEdge } from "../graph/edge";
import { lookupFlaggedReviewers } from "../reputation/client";
import { buildReport, type ReportOutcome } from "../score/buildReport";
import type { FeatureVector } from "../score/featureVector";
import type { ModelSet } from "../score/combine";
import type { FeatureVectorInputs } from "../score/featureVector";

export interface ReputationLookupDeps {
  isEnabled: () => Promise<boolean>;
  endpoint: string;
  salt: string;
  fetchImpl?: typeof fetch;
  random?: () => number;
  delay?: (ms: number) => Promise<void>;
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

export async function analyzePage(
  document: ParentNode,
  url: string,
  deps: OrchestratorDeps,
): Promise<AnalysisResult | null> {
  const page = parseProductUrl(url);
  if (page === null) {
    return null;
  }
  const product = extractProductSnapshot(document, deps.rules, page, url);
  if (product === null) {
    return null;
  }
  const reviews = extractReviews(document, deps.rules, page.locale);
  const outcome = await scoreAndMaybeSave(page, product, reviews, deps);
  return { page, product, reviews, outcome };
}

function productText(product: ProductSnapshot): string {
  return product.category === null ? product.title : `${product.title} ${product.category}`;
}

async function scoreAndMaybeSave(
  page: ParsedProductPage,
  product: ProductSnapshot,
  reviews: readonly Review[],
  deps: OrchestratorDeps,
  signatureCache?: WeakMap<Review, bigint[]>,
  embeddingCache?: WeakMap<Review, number[]>,
): Promise<ReportOutcome> {
  if (product.claimedRating === null) {
    return { status: "not-enough-data" };
  }

  const flaggedReviewerIds = deps.reputation && (await deps.reputation.isEnabled())
    ? await flaggedReviewers(reviews, deps.reputation)
    : undefined;

  const outcome: ReportOutcome = buildReport({
    reviews,
    seed: product.url,
    claimedRating: product.claimedRating,
    productText: productText(product),
    model: deps.model,
    priors: deps.priors,
    now: deps.now,
    random: deps.random,
    bootstrapResamples: deps.bootstrapResamples,
    signatureCache,
    embeddingCache,
    flaggedReviewerIds,
  });

  if (outcome.status === "ok" && deps.graphContribution && (await deps.graphContribution.isEnabled())) {
    await queueGraphContribution(page, reviews, deps.graphContribution);
  }

  if (outcome.status === "ok" && (await deps.isHistoryEnabled())) {
    await deps.saveHistory({
      title: product.title,
      thumbnailUrl: product.thumbnailUrl,
      report: outcome.report,
      featureVector: outcome.featureVector,
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
  });
}

export function mergeReviews(existing: readonly Review[], fetched: readonly Review[]): Review[] {
  const seen = new Set(
    existing
      .filter((review) => review.reviewerId !== null && review.date !== null)
      .map((review) => `${review.reviewerId}:${review.date}`),
  );
  const merged = [...existing];
  for (const review of fetched) {
    const key = review.reviewerId !== null && review.date !== null
      ? `${review.reviewerId}:${review.date}`
      : null;
    if (key !== null && seen.has(key)) {
      continue;
    }
    if (key !== null) {
      seen.add(key);
    }
    merged.push(review);
  }
  return merged;
}

export interface CheckMoreDeeplyOptions {
  maxPages?: number;
  fetchImpl?: typeof fetch;
  delay?: (ms: number) => Promise<void>;
  random?: () => number;
  onProgress?: (progress: FetchProgress) => void;
}

export async function checkMoreDeeply(
  page: ParsedProductPage,
  product: ProductSnapshot,
  existingReviews: readonly Review[],
  deps: OrchestratorDeps,
  options: CheckMoreDeeplyOptions = {},
): Promise<AnalysisResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetched = await fetchReviewPages({
    productId: page.productId,
    site: page.site,
    maxPages: options.maxPages,
    delay: options.delay,
    random: options.random,
    onProgress: options.onProgress,
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
    fetched.signatures,
    fetched.embeddings,
  );
  return { page, product, reviews, outcome };
}
