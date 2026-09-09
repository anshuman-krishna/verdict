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

export interface CompositeStrategy {
  strategy: "composite";
  container: string;
  fields: Record<string, FieldRule>;
  fallback?: FieldRule;
}

export interface PresenceStrategy {
  strategy: "presence";
  value: string;
  fallback?: FieldRule;
}

export type FieldRule =
  | EmbeddedJsonStrategy
  | SelectorStrategy
  | CompositeStrategy
  | PresenceStrategy;

export interface RulesDocument {
  version: number;
  site: string;
  locales: string[];
  fields: Record<string, FieldRule>;
}
