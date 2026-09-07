import type { FieldRule, RulesDocument } from "./rules";

// a signature says who wrote a document, not that it is well formed. a malformed rule degrades to
// zero matches, which is indistinguishable from a page that changed.
// an unusable field is dropped so the rest of a document still delivers its fixes; a document with
// none left is refused, since that is an outage rather than a fix

// fallback chains are a handful deep in practice. The cap is here so a pathological document cannot
// make validation walk as far as the file is long.
const MAX_FALLBACK_DEPTH = 10;

export interface SanitisedRules {
  rules: RulesDocument;
  // one line per field that was dropped and why, for the canary and for
  // whoever is looking at why a fix did not take
  problems: string[];
}

export function sanitiseRulesDocument(value: unknown): SanitisedRules | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const version = record.version;
  const site = record.site;
  const locales = record.locales;
  const fields = record.fields;

  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    return null;
  }
  if (typeof site !== "string" || site === "") {
    return null;
  }
  if (!Array.isArray(locales) || locales.some((locale) => typeof locale !== "string" || locale === "")) {
    return null;
  }
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    return null;
  }

  const problems: string[] = [];
  const usable: Record<string, FieldRule> = {};
  for (const [name, rule] of Object.entries(fields as Record<string, unknown>)) {
    const problem = fieldProblem(rule, 0);
    if (problem === null) {
      usable[name] = rule as FieldRule;
    } else {
      problems.push(`${name}: ${problem}`);
    }
  }

  if (Object.keys(usable).length === 0) {
    return null;
  }
  return {
    rules: { version, site, locales: locales as string[], fields: usable },
    problems,
  };
}

// null when the rule is usable, otherwise why it is not.
function fieldProblem(value: unknown, depth: number): string | null {
  if (depth > MAX_FALLBACK_DEPTH) {
    return `fallback chain deeper than ${MAX_FALLBACK_DEPTH}`;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "not an object";
  }
  const rule = value as Record<string, unknown>;
  const own = strategyProblem(rule);
  if (own !== null) {
    return own;
  }
  if (rule.fallback === undefined) {
    return null;
  }
  const fallback = fieldProblem(rule.fallback, depth + 1);
  return fallback === null ? null : `fallback ${fallback}`;
}

function strategyProblem(rule: Record<string, unknown>): string | null {
  switch (rule.strategy) {
    case "embedded-json":
      return (
        nonEmptyString(rule.path, "path") ?? optionalString(rule.scriptSelector, "scriptSelector")
      );
    case "selector":
      return nonEmptyString(rule.value, "value") ?? optionalString(rule.attribute, "attribute");
    case "presence":
      return nonEmptyString(rule.value, "value");
    case "composite":
      return compositeProblem(rule);
    default:
      return `unknown strategy ${JSON.stringify(rule.strategy)}`;
  }
}

function compositeProblem(rule: Record<string, unknown>): string | null {
  const container = nonEmptyString(rule.container, "container");
  if (container !== null) {
    return container;
  }
  const fields = rule.fields;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    return "fields is not an object";
  }
  const entries = Object.entries(fields as Record<string, unknown>);
  if (entries.length === 0) {
    return "fields is empty, so every container would yield an empty record";
  }
  for (const [name, sub] of entries) {
    // a composite's own fields start a fresh chain: they are resolved against a container, not
    // against the page, so their depth is not the outer chain's depth.
    const problem = fieldProblem(sub, 0);
    if (problem !== null) {
      return `field ${name} ${problem}`;
    }
  }
  return null;
}

function nonEmptyString(value: unknown, key: string): string | null {
  return typeof value === "string" && value !== "" ? null : `${key} is missing or not a string`;
}

function optionalString(value: unknown, key: string): string | null {
  if (value === undefined) {
    return null;
  }
  return typeof value === "string" && value !== "" ? null : `${key} is not a string`;
}
