export interface EmbeddedJsonStrategy {
  strategy: "embedded-json";
  path: string;
  scriptSelector?: string;
  fallback?: FieldRule;
}

export interface SelectorStrategy {
  strategy: "selector";
  value: string;
  attribute?: string;
  fallback?: FieldRule;
}

export type FieldRule = EmbeddedJsonStrategy | SelectorStrategy;

export interface RulesDocument {
  version: number;
  site: string;
  locales: string[];
  fields: Record<string, FieldRule>;
}
