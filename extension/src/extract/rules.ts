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

// SPEC.md section 9's ordered preference ends at css selectors, and its own rules.json example
// falls back from an embedded json path to "[data-hook='review']" for the reviews field. A plain
// selector cannot express that: it yields one string per matched element, and a review is five
// fields. So a review set needs a strategy that matches a container per review and resolves each
// field inside it, or the most important field in the document is the one field with no fallback
// chain, which is the opposite of what "a broken selector fixed in an hour" is meant to mean.
export interface CompositeStrategy {
  strategy: "composite";
  // one match per record, so this selects review blocks, not fields
  container: string;
  // each rule resolves against its own container element rather than the
  // page, and contributes that container's value for one key
  fields: Record<string, FieldRule>;
  fallback?: FieldRule;
}

// a field whose answer is whether anything matched at all, not what it says. "Verified Purchase" is
// "Achat vérifié" and "Verifizierter Kauf" elsewhere, so reading the badge's text would need a
// translation table where its presence needs nothing.
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
