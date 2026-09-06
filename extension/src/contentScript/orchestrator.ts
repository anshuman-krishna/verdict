import { fetchReviewPages } from "../extract/fetchReviewPages";
import { extractProductSnapshot, extractReviews } from "../extract/reviewExtraction";
import { parseAmazonProductUrl, reviewPageUrl, type ParsedProductPage } from "../extract/productPage";
import type { RulesDocument } from "../extract/rules";
import type { ProductSnapshot, Review } from "../extract/types";
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

  if (outcome.status === "ok" && (await deps.isHistoryEnabled())) {
    await deps.saveHistory({
      title: product.title,
      thumbnailUrl: product.thumbnailUrl,
      report: outcome.report,
    });
  }

  return outcome;
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
