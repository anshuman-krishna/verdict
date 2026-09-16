import { resolveFieldTraced, type StrategyTrace } from "../extract/interpreter";
import type { RulesDocument } from "../extract/rules";
import type { Review } from "../extract/types";
import { resolvePriors } from "../score/priors";
import { extractFull, type FullExtraction } from "./extractOnce";

// PLAN.md week one, tasks 5 and 7: rules are written against saved pages, and a rule
// that matched nothing looks exactly like a page that says nothing unless the chain
// that ran is visible.

export interface FieldExplanation {
  field: string;
  value: unknown;
  steps: StrategyTrace[];
}

export interface Explanation {
  url: string;
  site: string | null;
  locale: string | null;
  rulesVersion: number;
  reviewCount: number;
  fields: FieldExplanation[];
  firstReview: Review | null;
  // which prior the category read off this page would be scored against
  priorsKey: string | null;
}

function valueOf(field: string, extraction: FullExtraction): unknown {
  if (field === "reviews") {
    return extraction.reviews.length;
  }
  const product = extraction.product as unknown as Record<string, unknown> | null;
  return product === null ? null : product[field] ?? null;
}

export function explainExtraction(
  document: ParentNode,
  url: string,
  rules: RulesDocument,
): Explanation {
  const extraction = extractFull(document, url, rules);
  const fields = Object.entries(rules.fields).map(([field, rule]) => ({
    field,
    value: valueOf(field, extraction),
    steps: resolveFieldTraced(document, rule).trace,
  }));
  return {
    url,
    site: extraction.site,
    locale: extraction.locale,
    rulesVersion: extraction.rulesVersion,
    reviewCount: extraction.reviews.length,
    fields,
    firstReview: extraction.reviews[0] ?? null,
    priorsKey: resolvePriors(extraction.product?.category ?? null).key,
  };
}

function show(value: unknown): string {
  if (value === null || value === undefined) {
    return "nothing";
  }
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function matchCount(matched: number): string {
  return matched === 1 ? "1 match" : `${matched} matches`;
}

function stepLine(step: StrategyTrace): string {
  const format = step.format === "machine" ? ", machine numbers" : "";
  const join = step.join === undefined ? "" : `, joined with ${JSON.stringify(step.join)}`;
  return `    ${step.strategy}  ${step.target}  ${matchCount(step.matched)}${format}${join}`;
}

function reviewLine(review: Review): string {
  const parts = [
    review.rating === null ? "no rating" : `${review.rating} stars`,
    review.date ?? "no date",
    review.verified === null ? "verification unknown" : review.verified ? "verified" : "unverified",
    review.reviewerId === null ? "no reviewer id" : "has a reviewer id",
  ];
  return `  ${parts.join(", ")}${review.text === null ? "" : `, ${show(review.text.slice(0, 60))}`}`;
}

export function formatExplanation(explanation: Explanation): string {
  const lines = [
    explanation.url,
    `${explanation.site ?? "no supported site"} ${explanation.locale ?? ""}`.trim() +
      `, rules version ${explanation.rulesVersion}`,
    "",
  ];
  if (explanation.fields.length === 0) {
    lines.push("this build has no rule for any field, so the page was never read");
  }
  for (const field of explanation.fields) {
    lines.push(`  ${field.field}: ${show(field.value)}`);
    for (const step of field.steps) {
      lines.push(stepLine(step));
    }
  }
  lines.push(
    "",
    `priors: ${explanation.priorsKey ?? "default, no category estimate matched"}`,
    `${explanation.reviewCount} reviews read`,
  );
  if (explanation.firstReview !== null) {
    lines.push(reviewLine(explanation.firstReview));
  }
  return lines.join("\n");
}
