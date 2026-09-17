import type { FieldRule, RulesDocument } from "./rules";
import { STRUCTURED_SOURCES, type StructuredSource } from "./structuredData";

// schema.org product markup is a published standard rather than one storefront's
// dom, so these paths are the one ruleset that can be written without a saved page
// to check it against. SPEC.md section 9 puts embedded json first for this reason.

const PRODUCT = "$..[?(@.@type=='Product')]";
const AGGREGATE = "$..[?(@.@type=='AggregateRating')]";
const BREADCRUMB = "$..[?(@.@type=='BreadcrumbList')]";
const REVIEW = "$..[?(@.@type=='Review')]";

// the trail a storefront puts a listing under, read back widest first, which is the
// order a prior is looked up in. SPEC.md 5.1 wants the category, and a breadcrumb is
// where a page actually says it.
export const CATEGORY_SEPARATOR = " > ";

// the same vocabulary in the three serialisations the standard allows, json-ld first
// because it is one parse of one block, and the attribute forms after it
function from(source: StructuredSource): { source?: StructuredSource } {
  return source === "script" ? {} : { source };
}

function perSource<T>(build: (source: StructuredSource) => T): T[] {
  return STRUCTURED_SOURCES.map(build);
}

function chain(rules: readonly FieldRule[]): FieldRule {
  const [first, ...rest] = rules;
  if (first === undefined) {
    throw new Error("a field needs at least one rule");
  }
  return rest.length === 0 ? first : { ...first, fallback: chain(rest) };
}

interface PathOptions {
  format?: "machine";
  join?: string;
}

function jsonPaths(paths: readonly string[], options: PathOptions = {}): FieldRule[] {
  return STRUCTURED_SOURCES.flatMap((source) =>
    paths.map((path): FieldRule => ({
      strategy: "embedded-json",
      path,
      ...options,
      ...from(source),
    })),
  );
}

const REVIEW_FIELDS: Readonly<Record<string, string[]>> = {
  rating: ["$.reviewRating.ratingValue", "$.ratingValue"],
  text: ["$.reviewBody", "$.description"],
  date: ["$.datePublished", "$.dateCreated"],
  // the standard carries no stable account id, and a display name is not one,
  // so the reviewer signals get nothing here rather than getting a guess
  reviewerId: ["$.author.@id", "$.author.url"],
};

const CATEGORY_PATHS = [
  // category is one string or a list of them, and a list is already the trail
  `${PRODUCT}.category[*]`,
  `${PRODUCT}.category`,
  `${BREADCRUMB}.itemListElement[*].item.name`,
  `${BREADCRUMB}.itemListElement[*].name`,
];

// every chain ends in a selector because an itemprop outside any itemscope is markup
// the structured reader will not claim, and nothing else would find it
export const STANDARD_FIELDS: Readonly<Record<string, FieldRule>> = {
  title: chain([
    ...jsonPaths([`${PRODUCT}.name`]),
    { strategy: "selector", value: 'meta[property="og:title"]', attribute: "content" },
  ]),
  category: chain([
    ...jsonPaths(CATEGORY_PATHS, { join: CATEGORY_SEPARATOR }),
    {
      strategy: "selector",
      value: '[itemtype$="schema.org/BreadcrumbList"] [itemprop="name"]',
      join: CATEGORY_SEPARATOR,
    },
  ]),
  claimedRating: chain([
    ...jsonPaths([`${AGGREGATE}.ratingValue`, "$..aggregateRating.ratingValue"], {
      format: "machine",
    }),
    { strategy: "selector", value: '[itemprop="ratingValue"]', attribute: "content" },
  ]),
  reviewCount: chain([
    ...jsonPaths([`${AGGREGATE}.reviewCount`, `${AGGREGATE}.ratingCount`], { format: "machine" }),
    { strategy: "selector", value: '[itemprop="reviewCount"]', attribute: "content" },
  ]),
  thumbnailUrl: chain([
    // image is a url, a list of them, or an ImageObject, in that order of frequency
    ...jsonPaths([`${PRODUCT}.image[*]`, `${PRODUCT}.image.url`, `${PRODUCT}.image`]),
    { strategy: "selector", value: 'meta[property="og:image"]', attribute: "content" },
  ]),
  reviews: chain(
    perSource((source): FieldRule => ({
      strategy: "json-records",
      format: "machine",
      path: REVIEW,
      fields: REVIEW_FIELDS,
      ...from(source),
    })),
  ),
};

const MAX_APPENDED_DEPTH = 8;

function endsWith(rule: FieldRule, standard: FieldRule): boolean {
  let current: FieldRule | undefined = rule;
  while (current !== undefined) {
    if (current === standard) {
      return true;
    }
    current = current.fallback;
  }
  return false;
}

function withTail(rule: FieldRule, standard: FieldRule, depth: number): FieldRule {
  if (rule.fallback === undefined) {
    // a chain already this long is a rule that has been fixed many times, leave it be
    return depth >= MAX_APPENDED_DEPTH ? rule : { ...rule, fallback: standard };
  }
  return { ...rule, fallback: withTail(rule.fallback, standard, depth + 1) };
}

// the storefront's own rules run first, and the standard catches what they miss
export function withStandardFallback(
  rules: RulesDocument,
  standard: Readonly<Record<string, FieldRule>> = STANDARD_FIELDS,
): RulesDocument {
  const fields: Record<string, FieldRule> = { ...rules.fields };
  for (const [name, fallback] of Object.entries(standard)) {
    const own = fields[name];
    if (own === undefined) {
      fields[name] = fallback;
      continue;
    }
    if (endsWith(own, fallback)) {
      continue;
    }
    fields[name] = withTail(own, fallback, 0);
  }
  return { ...rules, fields };
}
