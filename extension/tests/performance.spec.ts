// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { extractProductSnapshot, extractReviews } from "../src/extract/reviewExtraction";
import { parseProductUrl } from "../src/extract/sites";
import type { RulesDocument } from "../src/extract/rules";
import { ANALYSIS_BUDGET_MS, formatVerdict, judge, measure } from "../src/perf/budget";
import { syntheticProductPageHtml, syntheticReviews } from "../src/perf/syntheticLoad";
import { buildReport } from "../src/score/buildReport";
import { localModelSet, type CombinerModel } from "../src/score/combine";
import { PLACEHOLDER_PRIORS } from "../src/score/priors";


const DEFAULT_PATH_REVIEWS = 60;
const HARD_CASE_REVIEWS = 300;
const RUNS = 5;

const MAXIMUM_GROWTH_RATIO = 10;

const RULES: RulesDocument = {
  version: 1,
  site: "amazon",
  locales: ["com"],
  fields: {
    title: { strategy: "embedded-json", path: "$.title" },
    claimedRating: { strategy: "embedded-json", path: "$.rating" },
    reviewCount: { strategy: "embedded-json", path: "$.reviewCount" },
    reviews: { strategy: "embedded-json", path: "$.reviews[*]" },
  },
};

const URL = "https://www.amazon.com/dp/B0PERF0001";
const PRODUCT_TEXT = "a product";

const MODEL: CombinerModel = {
  intercept: -1,
  coefficients: {
    "textNearDuplication.duplicateReviewShare": 2,
    "listingDrift.driftStatistic": 1,
  },
  calibration: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
};

function timeAnalysis(count: number) {
  const reviews = syntheticReviews({ count, seed: 42 });
  const container = document.createElement("div");
  container.innerHTML = syntheticProductPageHtml(reviews, "a product");
  const page = parseProductUrl(URL);
  if (page === null) {
    throw new Error("the timing url is not a product url this build can parse");
  }

  const measurement = measure(`full analysis, ${count} reviews`, RUNS, () => {
    const product = extractProductSnapshot(container, RULES, page, URL);
    const extracted = extractReviews(container, RULES, page.locale);
    buildReport({
      reviews: extracted,
      seed: URL,
      claimedRating: product?.claimedRating ?? 4.6,
      productText: PRODUCT_TEXT,
      model: localModelSet(MODEL),
      priors: PLACEHOLDER_PRIORS,
    });
  });
  const verdict = judge(measurement);
  console.log(formatVerdict(verdict));
  return verdict;
}

describe("analysis time budget", () => {
  const defaultPath = timeAnalysis(DEFAULT_PATH_REVIEWS);
  const hardCase = timeAnalysis(HARD_CASE_REVIEWS);

  it(`stays under ${ANALYSIS_BUDGET_MS}ms on the default path`, () => {
    expect(defaultPath.withinBudget).toBe(true);
  });

  it(`stays under ${ANALYSIS_BUDGET_MS}ms on ${HARD_CASE_REVIEWS} reviews`, () => {
    expect(hardCase.withinBudget).toBe(true);
  });

  it("grows no worse than roughly linearly in the review count", () => {
    const ratio = hardCase.medianMs / Math.max(defaultPath.medianMs, 1);
    expect(ratio).toBeLessThan(MAXIMUM_GROWTH_RATIO);
  });
});
