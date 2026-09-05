import type { RulesDocument } from "./rules";

// the field rules themselves (embedded json paths, selector fallbacks)
// depend on real amazon page structure, verified against the 40 page
// fixture corpus in PLAN.md week 1 tasks 2 and 5. that corpus is hand
// built and does not exist yet, so fields stays empty rather than
// guessing at selectors nothing has checked against a real page. site
// and locales are just the SPEC.md section 9 example, safe to bundle now
// since resolveField degrades to an empty match on any unset field
// instead of throwing.
export const BUNDLED_AMAZON_RULES: RulesDocument = {
  version: 0,
  site: "amazon",
  locales: ["com", "fr", "de", "co.uk"],
  fields: {},
};
