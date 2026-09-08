import { parseAmazonProductUrl } from "../extract/productPage";
import { extractProductSnapshot, extractReviews } from "../extract/reviewExtraction";
import type { RulesDocument } from "../extract/rules";
import type { ProductSnapshot, Review } from "../extract/types";

// PLAN.md week 7's canary needs one number from a live page: how many reviews the shipped extractor
// finds on it today. PLAN.md week 4's corpus needs the reviews themselves, off a saved page. The
// extractor is this package's own, and re-implementing it in python to answer either would put two
// versions of the thing being watched in the repository, one of which nobody uses. So the python
// side drives this instead.
//
// everything here runs the same two functions the content script runs. It deliberately adds no
// fallback, no retry, and no leniency: a canary that is more forgiving than the product reports
// health the product does not have.

export interface CanaryExtraction {
  url: string;
  site: string | null;
  locale: string | null;
  rulesVersion: number;
  reviewCount: number;
  // null when the page did not identify itself, which is the same thing
  // that makes the content script render nothing at all
  title: string | null;
}

// what a corpus row is built from. kept out of CanaryExtraction because the canary alerts on what
// it finds, and an alert path is the last place review text belongs.
export interface FullExtraction extends CanaryExtraction {
  product: ProductSnapshot | null;
  reviews: Review[];
}

export function extractFull(
  document: ParentNode,
  url: string,
  rules: RulesDocument,
): FullExtraction {
  const page = parseAmazonProductUrl(url);
  const base = {
    url,
    site: page?.site ?? null,
    locale: page?.locale ?? null,
    rulesVersion: rules.version,
  };
  if (page === null) {
    return { ...base, reviewCount: 0, title: null, product: null, reviews: [] };
  }
  const product = extractProductSnapshot(document, rules, page, url);
  const reviews = extractReviews(document, rules, page.locale);
  return {
    ...base,
    reviewCount: reviews.length,
    title: product?.title ?? null,
    product,
    reviews,
  };
}

export function extractOnce(
  document: ParentNode,
  url: string,
  rules: RulesDocument,
): CanaryExtraction {
  const { product: _product, reviews: _reviews, ...counts } = extractFull(document, url, rules);
  return counts;
}
