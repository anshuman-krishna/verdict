import { parseAmazonProductUrl } from "../extract/productPage";
import { extractProductSnapshot, extractReviews } from "../extract/reviewExtraction";
import type { RulesDocument } from "../extract/rules";

// PLAN.md week 7's canary needs one number from a live page: how many
// reviews the shipped extractor finds on it today. The extractor is this
// package's own, and re-implementing it in python to answer that would put
// two versions of the thing being watched in the repository, one of which
// nobody uses. So the python job drives this instead.
//
// Everything here runs the same two functions the content script runs. It
// deliberately adds no fallback, no retry, and no leniency: a canary that
// is more forgiving than the product reports health the product does not
// have.

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

export function extractOnce(
  document: ParentNode,
  url: string,
  rules: RulesDocument,
): CanaryExtraction {
  const page = parseAmazonProductUrl(url);
  const base = {
    url,
    site: page?.site ?? null,
    locale: page?.locale ?? null,
    rulesVersion: rules.version,
  };
  if (page === null) {
    return { ...base, reviewCount: 0, title: null };
  }
  const product = extractProductSnapshot(document, rules, page, url);
  return {
    ...base,
    reviewCount: extractReviews(document, rules, page.locale).length,
    title: product?.title ?? null,
  };
}
