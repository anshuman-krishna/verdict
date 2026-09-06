import { fetchReviewPages, type FetchProgress } from "../extract/fetchReviewPages";
import { extractProductSnapshot, extractReviews } from "../extract/reviewExtraction";
import { parseAmazonProductUrl, reviewPageUrl, type ParsedProductPage } from "../extract/productPage";
import type { RulesDocument } from "../extract/rules";
import type { ProductSnapshot, Review } from "../extract/types";
import { buildContributionEdge, type ContributionEdge } from "../graph/edge";
import { lookupFlaggedReviewers } from "../reputation/client";
import { buildReport, type ReportOutcome } from "../score/buildReport";
import type { CombinerModel } from "../score/combine";
import type { FeatureVectorInputs } from "../score/featureVector";
import type { Report } from "../score/report";
import { reviewerGraphEvidenceRow } from "../score/reviewerGraphEvidence";

// SPEC.md section 4: the reviewer graph service is opt in and off by
// default. isEnabled is checked fresh on every analysis (rather than baked
// in at wiring time) so flipping the options page toggle takes effect on
// the very next check, not after a reload.
export interface ReputationLookupDeps {
  isEnabled: () => Promise<boolean>;
  endpoint: string;
  salt: string;
  fetchImpl?: typeof fetch;
  random?: () => number;
  // reputation/client.ts's own default (a real setTimeout, PRIVACY.md
  // section 4's random request delay) is what production uses; exposed
  // here only so a test can swap in an instant no-op instead of actually
  // waiting up to MAX_DELAY_MS.
  delay?: (ms: number) => Promise<void>;
}

export interface OrchestratorDeps {
  rules: RulesDocument;
  model: CombinerModel | null;
  priors: FeatureVectorInputs;
  isHistoryEnabled: () => Promise<boolean>;
  saveHistory: (entry: { title: string; thumbnailUrl: string | null; report: unknown }) => Promise<unknown>;
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

// PRIVACY.md section 5: a second, separate opt in from reputation lookup
// above. isEnabled is checked fresh per analysis for the same reason
// reputation's is: the options page toggle should take effect on the
// very next check.
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

// the single entry point a content script calls on load. Every early exit
// here is a documented SPEC.md section 13 row: not a supported page, or a
// product page whose title could not be found at all, both render nothing.
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
  const reviews = extractReviews(document, deps.rules);
  const outcome = await scoreAndMaybeSave(page, product, reviews, deps);
  return { page, product, reviews, outcome };
}

async function scoreAndMaybeSave(
  page: ParsedProductPage,
  product: ProductSnapshot,
  reviews: readonly Review[],
  deps: OrchestratorDeps,
): Promise<ReportOutcome> {
  // the claimed rating is one of the two figures the certificate block
  // shows side by side (DESIGN.md section 6); a report with no claimed
  // rating to adjust against is not a report SPEC.md section 2 promises.
  if (product.claimedRating === null) {
    return { status: "not-enough-data" };
  }

  let outcome: ReportOutcome = buildReport({
    reviews,
    seed: product.url,
    claimedRating: product.claimedRating,
    model: deps.model,
    priors: deps.priors,
    now: deps.now,
    random: deps.random,
    bootstrapResamples: deps.bootstrapResamples,
  });

  if (outcome.status === "ok" && deps.reputation && (await deps.reputation.isEnabled())) {
    outcome = {
      status: "ok",
      report: await withReviewerGraphEvidence(outcome.report, reviews, deps.reputation),
    };
  }

  if (outcome.status === "ok" && deps.graphContribution && (await deps.graphContribution.isEnabled())) {
    await queueGraphContribution(page, reviews, deps.graphContribution);
  }

  if (outcome.status === "ok" && (await deps.isHistoryEnabled())) {
    await deps.saveHistory({
      title: product.title,
      thumbnailUrl: product.thumbnailUrl,
      report: outcome.report,
    });
  }

  return outcome;
}

// PRIVACY.md section 5: builds one edge per review this page's reviews
// contain enough to place (buildContributionEdge already returns null for
// the rest) and hands the batch to the queue, which is what actually
// applies the randomised hold before anything is sent. Best effort: a
// review whose edge cannot be built is simply not contributed, never a
// reason to fail the analysis that surfaced it.
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

// SPEC.md 5.6 and section 8: looks up whether any of this review set's
// reviewer ids fall in a flagged bucket, entirely through the k anonymous
// protocol in reputation/lookup.ts and reputation/client.ts, and appends
// one evidence row with the result. Community scoring itself, what makes
// a bucket flagged in the first place, happens server side and is not
// this function's concern; if the lookup fails or the service is
// unreachable, lookupFlaggedReviewers already resolves to an empty set,
// so this degrades to the same "none flagged" row rather than an error.
async function withReviewerGraphEvidence(
  report: Report,
  reviews: readonly Review[],
  reputation: ReputationLookupDeps,
): Promise<Report> {
  const reviewerIds = reviews
    .map((review) => review.reviewerId)
    .filter((id): id is string => id !== null);
  const flagged = await lookupFlaggedReviewers(reviewerIds, {
    endpoint: reputation.endpoint,
    salt: reputation.salt,
    fetchImpl: reputation.fetchImpl,
    random: reputation.random,
    delay: reputation.delay,
  });
  const row = reviewerGraphEvidenceRow(flagged.size, reviewerIds.length);
  return { ...report, evidence: [...report.evidence, row] };
}

// merges reviews already visible on the product page with a freshly
// fetched batch, deduping on reviewerId plus date where both are known
// (amazon does not expose a stable per-review id anywhere this project has
// a rule for). a review missing either field cannot be matched against
// anything, so it is always kept, which only risks a rare double count,
// never a silent drop.
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

// SPEC.md section 9: fetching additional review pages happens only on
// explicit user action, never on page load, which is why this is a
// separate exported function rather than something analyzePage calls
// itself. Re-scores and, if history is enabled, re-saves against the
// enlarged review set.
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
    product,
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
      return extractReviews(parsed, deps.rules);
    },
  });

  const reviews = mergeReviews(existingReviews, fetched);
  const outcome = await scoreAndMaybeSave(page, product, reviews, deps);
  return { page, product, reviews, outcome };
}
