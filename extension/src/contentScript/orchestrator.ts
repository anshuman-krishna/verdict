import {
  DEFAULT_MAX_PAGES,
  fetchReviewPages,
  NO_REVIEWS_CACHE,
  type FetchProgress,
  type FetchStop,
  type ReviewsCachePort,
} from "../extract/fetchReviewPages";
import { extractProductSnapshot, extractReviews } from "../extract/reviewExtraction";
import { mergeReviews } from "../extract/reviewIdentity";
import {
  absentSignalsFor,
  parseProductUrl,
  reviewPageUrl,
  type ParsedProductPage,
} from "../extract/sites";
import { newPageIndex } from "../extract/structuredData";
import type { RulesDocument } from "../extract/rules";
import type { ProductSnapshot, Review } from "../extract/types";
import { buildContributionEdge, type ContributionEdge } from "../graph/edge";
import { cacheKey } from "../storage/reviewsCodec";
import type { PreviousCheck } from "../storage/history";
import { NOT_WATCHED, type WatchStatus } from "../storage/watchlist";
import { readingFromReport, type WatchReading } from "../watchlist/reading";
import { lookupFlaggedReviewers } from "../reputation/client";
import { buildReport, type ReportOutcome } from "../score/buildReport";
import type { FeatureVector } from "../score/featureVector";
import { signalsFor, type ModelSet } from "../score/combine";
import type { PriorsForCategory } from "../score/priors";

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
  priors: PriorsForCategory;
  isHistoryEnabled: () => Promise<boolean>;
  saveHistory: (
    entry: {
      title: string;
      thumbnailUrl: string | null;
      report: unknown;
      featureVector: FeatureVector;
      productKey: string | null;
    },
  ) => Promise<unknown>;
  previousChecks?: (productKey: string) => Promise<PreviousCheck[]>;
  // a listing nobody saved records nothing, which the port answers for itself
  recordWatchedCheck?: (productKey: string, reading: WatchReading) => Promise<WatchStatus>;
  // used by the panel, which is where a listing is saved and let go of
  watchToggle?: (request: WatchToggleRequest) => Promise<WatchStatus>;
  now?: () => number;
  random?: () => number;
  bootstrapResamples?: number;
  reputation?: ReputationLookupDeps;
  graphContribution?: GraphContributionDeps;
  // what this build is, so a report can say what produced it
  provenance?: BuildProvenance;
}

export interface WatchToggleRequest {
  // the state the reader asked for
  watching: boolean;
  productKey: string;
  site: string;
  title: string;
  thumbnailUrl: string | null;
  reading: WatchReading;
}

export interface BuildProvenance {
  extensionVersion: string;
  modelTrainedAt: number | null;
  modelDigest: string | null;
}

export interface GraphContributionDeps {
  isEnabled: () => Promise<boolean>;
  salt: string;
  enqueue: (edges: readonly ContributionEdge[]) => Promise<void>;
}

// what a deeper read actually managed, so the ui never offers a pass that cannot add anything
export interface FetchSummary {
  pagesFetched: number;
  maxPages: number;
  stoppedBecause: FetchStop;
}

export interface AnalysisResult {
  page: ParsedProductPage;
  // the local hash of this listing, which is what the watchlist is keyed by
  productKey?: string;
  // null when the url named a product and the page itself could not be read
  product: ProductSnapshot | null;
  reviews: Review[];
  outcome: ReportOutcome;
  previousChecks?: PreviousCheck[];
  watch?: WatchStatus;
  // absent until a read went past the page the user is on
  fetch?: FetchSummary;
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
  // no rules for this site is a state of the build, not a claim about the page
  if (Object.keys(deps.rules.fields).length === 0) {
    return null;
  }
  // one reading of this page's structured data, shared by the product and the reviews
  const index = newPageIndex();
  const product = extractProductSnapshot(document, deps.rules, page, url, index);
  if (product === null) {
    const unreadable: AnalysisResult = {
      page,
      product: null,
      reviews: [],
      outcome: { status: "unreadable" },
    };
    options.onStage?.({ result: unreadable, pending: [] });
    return unreadable;
  }
  options.onRecognised?.(page);
  const reviews = extractReviews(document, deps.rules, page.locale, index, deps.now?.());
  const productKey = await cacheKey(page.productId, page.site);
  const previousChecks = await earlierChecks(productKey, deps);
  const outcome = await scoreAndMaybeSave(page, product, reviews, deps, options, productKey);
  const watch = await watchedStatus(productKey, outcome, deps);
  const result = { page, product, reviews, outcome, previousChecks, watch, productKey };
  options.onStage?.({ result, pending: [] });
  return result;
}

async function earlierChecks(
  productKey: string,
  deps: OrchestratorDeps,
): Promise<PreviousCheck[]> {
  if (deps.previousChecks === undefined) {
    return [];
  }
  try {
    return await deps.previousChecks(productKey);
  } catch {
    // a listing nobody can look up still gets a report
    return [];
  }
}

async function watchedStatus(
  productKey: string,
  outcome: ReportOutcome,
  deps: OrchestratorDeps,
): Promise<WatchStatus> {
  if (deps.recordWatchedCheck === undefined || outcome.status !== "ok") {
    return NOT_WATCHED;
  }
  try {
    return await deps.recordWatchedCheck(
      productKey,
      readingFromReport(outcome.report, outcome.featureVector),
    );
  } catch {
    // a watchlist that cannot be written still leaves a report on the screen
    return NOT_WATCHED;
  }
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
  productKey: string | null = null,
  signatureCache?: WeakMap<Review, bigint[]>,
  embeddingCache?: WeakMap<Review, number[]>,
): Promise<ReportOutcome> {
  if (product.claimedRating === null) {
    return { status: "not-enough-data" };
  }

  // reused by both passes
  const signatures = signatureCache ?? new WeakMap<Review, bigint[]>();
  const embeddings = embeddingCache ?? new WeakMap<Review, number[]>();
  // SPEC.md 5.1: a paperback and a kitchen appliance have different natural shapes
  const priors = deps.priors(product.category);
  const score = (flaggedReviewerIds?: ReadonlySet<string>): ReportOutcome =>
    buildReport({
      reviews,
      seed: product.url,
      claimedRating: product.claimedRating as number,
      productText: productText(product),
      model: deps.model,
      priors: priors.inputs,
      now: deps.now,
      random: deps.random,
      bootstrapResamples: deps.bootstrapResamples,
      signatureCache: signatures,
      embeddingCache: embeddings,
      flaggedReviewerIds,
      // SPEC.md section 6: a platform that never recorded a signal did not hide it
      absentSignals: absentSignalsFor(page.site),
      provenance: deps.provenance === undefined ? undefined : {
        ...deps.provenance,
        rulesVersion: deps.rules.version,
        rulesSite: deps.rules.site,
        priorsKey: priors.key,
      },
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
          productKey,
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

// a page that never answers must not hold the panel open forever
export const REVIEW_PAGE_TIMEOUT_MS = 15_000;

// a page that is not there has run out, any other refusal is a storefront saying not now
function isOutOfPages(status: number): boolean {
  return status === 404 || status === 410;
}

// headers and body under one deadline, so a trickled body cannot stall it either
async function fetchReviewPageHtml(
  fetchImpl: typeof fetch,
  url: string,
  pageNumber: number,
  timeoutMs: number,
): Promise<string | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`review page ${pageNumber} took longer than ${timeoutMs} ms`));
    }, timeoutMs);
  });
  // the reader's own session, so no anonymous init here
  const exchange = fetchImpl(url, { signal: controller.signal }).then(async (response) => {
    if (response.ok) {
      return await response.text();
    }
    if (isOutOfPages(response.status)) {
      return null;
    }
    throw new Error(`review page ${pageNumber} answered ${response.status}`);
  });
  exchange.catch(() => undefined);
  try {
    return await Promise.race([exchange, expired]);
  } finally {
    clearTimeout(timer);
  }
}

export interface CheckMoreDeeplyOptions {
  maxPages?: number;
  // asked before each page, so a read nobody is waiting for stops asking the storefront
  stillWanted?: () => boolean;
  pageTimeoutMs?: number;
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
      if (options.stillWanted?.() === false) {
        throw new Error("nobody is waiting for this read any more");
      }
      const html = await fetchReviewPageHtml(
        fetchImpl,
        reviewPageUrl(page, pageNumber),
        pageNumber,
        options.pageTimeoutMs ?? REVIEW_PAGE_TIMEOUT_MS,
      );
      if (html === null) {
        return [];
      }
      const parsed = new DOMParser().parseFromString(html, "text/html");
      return extractReviews(parsed, deps.rules, page.locale, newPageIndex(), deps.now?.());
    },
  });

  const reviews = mergeReviews(existingReviews, fetched.reviews);
  const productKey = await cacheKey(page.productId, page.site);
  const outcome = await scoreAndMaybeSave(
    page,
    product,
    reviews,
    deps,
    {},
    productKey,
    fetched.signatures,
    fetched.embeddings,
  );
  return {
    page,
    product,
    reviews,
    outcome,
    productKey,
    previousChecks: await earlierChecks(productKey, deps),
    watch: await watchedStatus(productKey, outcome, deps),
    fetch: {
      pagesFetched: fetched.pagesFetched,
      maxPages: options.maxPages ?? DEFAULT_MAX_PAGES,
      stoppedBecause: fetched.stoppedBecause,
    },
  };
}
