import { parseProductUrl } from "../extract/sites";
import { extractProductSnapshot, extractReviews } from "../extract/reviewExtraction";
import type { RulesDocument } from "../extract/rules";
import type { ProductSnapshot, Review } from "../extract/types";


export interface CanaryExtraction {
  url: string;
  site: string | null;
  locale: string | null;
  rulesVersion: number;
  reviewCount: number;
  title: string | null;
}

export interface FullExtraction extends CanaryExtraction {
  product: ProductSnapshot | null;
  reviews: Review[];
}

export function extractFull(
  document: ParentNode,
  url: string,
  rules: RulesDocument,
): FullExtraction {
  const page = parseProductUrl(url);
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
