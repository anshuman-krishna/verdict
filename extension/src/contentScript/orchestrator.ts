import { fetchReviewPages, type FetchProgress } from "../extract/fetchReviewPages";
import { extractProductSnapshot, extractReviews } from "../extract/reviewExtraction";
import { parseAmazonProductUrl, reviewPageUrl, type ParsedProductPage } from "../extract/productPage";
import type { RulesDocument } from "../extract/rules";
import type { ProductSnapshot, Review } from "../extract/types";
import { buildContributionEdge, type ContributionEdge } from "../graph/edge";
import { lookupFlaggedReviewers } from "../reputation/client";
import { buildReport, type ReportOutcome } from "../score/buildReport";
import type { FeatureVector } from "../score/featureVector";
import type { ModelSet } from "../score/combine";
import type { FeatureVectorInputs } from "../score/featureVector";

// isEnabled is read per analysis so the options toggle takes effect on the next check, not a reload
export interface ReputationLookupDeps {
  isEnabled: () => Promise<boolean>;
  endpoint: string;
  salt: string;
  fetchImpl?: typeof fetch;
  random?: () => number;
  // exposed only so a test can skip PRIVACY.md section 4's random request delay
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
  // omitted entirely (not just disabled) is also valid: analyzePage never
  // attempts a reputation lookup unless a caller supplies this.
  reputation?: ReputationLookupDeps;
  // omitted entirely is also valid, same as reputation above: analyzePage
  // never queues a contribution unless a caller supplies this.
  graphContribution?: GraphContributionDeps;
}

// PRIVACY.md section 5: a second, separate opt in, read per analysis like reputation above
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

// every early exit here is a SPEC.md section 13 row: render nothing at all
export async function analyzePage(
  document: ParentNode,
  url: string,
  deps: OrchestratorDeps,
): Promise<AnalysisResult | null> {
  const page = parseAmazonProductUrl(url);
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

// SPEC.md 5.4 compares each review against "the current product title and category"
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
  // nothing to adjust against, so not a report SPEC.md section 2 promises
  if (product.claimedRating === null) {
    return { status: "not-enough-data" };
  }

  // before scoring, not after: SPEC.md 5.6 is a signal in the feature vector, so a flagged share
  // that arrived once the report was built could only be pinned on beside a band computed without it
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

// best effort: an edge that cannot be built is not contributed, never a reason to fail the analysis
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

// an unreachable service degrades to an empty set, never an error: SPEC.md section 13 wants the
// analysis to carry on with local signals only and say nothing about it
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

// dedupes on reviewerId plus date; a review missing either is kept, risking a double count over a drop
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
  // SPEC.md section 13's spinner rule: this run takes seconds, so whoever
  // is showing a busy state needs something to put underneath it.
  onProgress?: (progress: FetchProgress) => void;
}

// SPEC.md section 9: user action only, never on page load, hence separate from analyzePage
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
