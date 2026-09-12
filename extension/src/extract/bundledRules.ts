import amazon from "./rules/amazon.json";
import type { RulesDocument } from "./rules";

// one entry per site in schema/sites.json. bundledRules.test.ts checks both
// directions, so a registry entry with no rules file fails the build rather
// than shipping a storefront this build cannot read.
export const BUNDLED_RULES: Readonly<Record<string, RulesDocument>> = {
  amazon: amazon as RulesDocument,
};

export function bundledRulesFor(siteId: string): RulesDocument | null {
  return BUNDLED_RULES[siteId] ?? null;
}

// a site with no rules yet reads nothing rather than reading wrongly
export function emptyRules(siteId: string): RulesDocument {
  return { version: 0, site: siteId, locales: [], fields: {} };
}
