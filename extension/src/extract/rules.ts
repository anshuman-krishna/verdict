// a storefront's own embedded json carries display text, json-ld carries machine
// values, and "1.234" reads as a different number under each. the rule says which.
export type NumberFormat = "locale" | "machine";

interface RuleBase {
  format?: NumberFormat;
  fallback?: FieldRule;
}

export interface EmbeddedJsonStrategy extends RuleBase {
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
export interface JsonRecordsStrategy extends RuleBase {
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
