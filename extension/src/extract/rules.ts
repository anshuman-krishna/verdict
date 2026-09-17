import type { StructuredSource } from "./structuredData";

// a storefront's own embedded json carries display text, json-ld carries machine
// values, and "1.234" reads as a different number under each. the rule says which.
export type NumberFormat = "locale" | "machine";

interface RuleBase {
  format?: NumberFormat;
  // a breadcrumb is one field spread over many nodes, so a rule can say how it reads back
  join?: string;
  fallback?: FieldRule;
}

// where the json comes from. a script block by default, and otherwise the page's own
// microdata or rdfa lite attributes read into the same shape, so one path reads both
export interface JsonSourced {
  source?: StructuredSource;
}

export interface EmbeddedJsonStrategy extends RuleBase, JsonSourced {
  strategy: "embedded-json";
  path: string;
  scriptSelector?: string;
}

export interface SelectorStrategy extends RuleBase {
  strategy: "selector";
  value: string;
  attribute?: string;
}

// json-ld describes a review as a nested node, so a record is built from paths
// inside each match rather than from one path per field across the document
export interface JsonRecordsStrategy extends RuleBase, JsonSourced {
  strategy: "json-records";
  path: string;
  scriptSelector?: string;
  fields: Record<string, string | string[]>;
}

export interface CompositeStrategy extends RuleBase {
  strategy: "composite";
  container: string;
  fields: Record<string, FieldRule>;
}

export interface PresenceStrategy extends RuleBase {
  strategy: "presence";
  value: string;
}

export type FieldRule =
  | EmbeddedJsonStrategy
  | JsonRecordsStrategy
  | SelectorStrategy
  | CompositeStrategy
  | PresenceStrategy;

export interface RulesDocument {
  version: number;
  site: string;
  locales: string[];
  fields: Record<string, FieldRule>;
}
