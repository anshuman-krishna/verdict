import type { FieldRule, RulesDocument } from "./rules";

// schema.org product markup is a published standard rather than one storefront's
// dom, so these paths are the one ruleset that can be written without a saved page
// to check it against. SPEC.md section 9 puts embedded json first for this reason.

const PRODUCT = "$..[?(@.@type=='Product')]";
const AGGREGATE = "$..[?(@.@type=='AggregateRating')]";
const BREADCRUMB = "$..[?(@.@type=='BreadcrumbList')]";

// the trail a storefront puts a listing under, read back widest first, which is the
// order a prior is looked up in. SPEC.md 5.1 wants the category, and a breadcrumb is
// where a page actually says it.
export const CATEGORY_SEPARATOR = " > ";

export const STANDARD_FIELDS: Readonly<Record<string, FieldRule>> = {
  title: {
    strategy: "embedded-json",
    path: `${PRODUCT}.name`,
    fallback: { strategy: "selector", value: 'meta[property="og:title"]', attribute: "content" },
  },
  category: {
    strategy: "embedded-json",
    // category is one string or a list of them, and a list is already the trail
    path: `${PRODUCT}.category[*]`,
    join: CATEGORY_SEPARATOR,
    fallback: {
      strategy: "embedded-json",
      path: `${PRODUCT}.category`,
      join: CATEGORY_SEPARATOR,
      fallback: {
        strategy: "embedded-json",
        path: `${BREADCRUMB}.itemListElement[*].item.name`,
        join: CATEGORY_SEPARATOR,
        fallback: {
          strategy: "embedded-json",
          path: `${BREADCRUMB}.itemListElement[*].name`,
          join: CATEGORY_SEPARATOR,
          fallback: {
            strategy: "selector",
            value: '[itemtype$="schema.org/BreadcrumbList"] [itemprop="name"]',
            join: CATEGORY_SEPARATOR,
          },
        },
      },
    },
  },
  claimedRating: {
    strategy: "embedded-json",
    format: "machine",
    path: `${AGGREGATE}.ratingValue`,
    fallback: {
      strategy: "embedded-json",
      format: "machine",
      path: "$..aggregateRating.ratingValue",
      fallback: {
        strategy: "selector",
        value: '[itemprop="ratingValue"]',
        attribute: "content",
      },
    },
  },
  reviewCount: {
    strategy: "embedded-json",
    format: "machine",
    path: `${AGGREGATE}.reviewCount`,
    fallback: {
      strategy: "embedded-json",
      format: "machine",
      path: `${AGGREGATE}.ratingCount`,
      fallback: {
        strategy: "selector",
        value: '[itemprop="reviewCount"]',
        attribute: "content",
      },
    },
  },
  thumbnailUrl: {
    strategy: "embedded-json",
    // image is a url, a list of them, or an ImageObject, in that order of frequency
    path: `${PRODUCT}.image[*]`,
    fallback: {
      strategy: "embedded-json",
      path: `${PRODUCT}.image.url`,
      fallback: {
        strategy: "embedded-json",
        path: `${PRODUCT}.image`,
        fallback: {
          strategy: "selector",
          value: 'meta[property="og:image"]',
          attribute: "content",
        },
      },
    },
  },
  reviews: {
    strategy: "json-records",
    format: "machine",
    path: "$..[?(@.@type=='Review')]",
    fields: {
      rating: ["$.reviewRating.ratingValue", "$.ratingValue"],
      text: ["$.reviewBody", "$.description"],
      date: ["$.datePublished", "$.dateCreated"],
      // the standard carries no stable account id, and a display name is not one,
      // so the reviewer signals get nothing here rather than getting a guess
      reviewerId: ["$.author.@id", "$.author.url"],
    },
  },
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
