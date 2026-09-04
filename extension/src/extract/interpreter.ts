import { queryJsonPath } from "./jsonpath";
import type { EmbeddedJsonStrategy, FieldRule, SelectorStrategy } from "./rules";

const DEFAULT_EMBEDDED_JSON_SELECTOR = 'script[type="application/ld+json"]';

// walks a field's strategy, then its fallback chain, stopping at the first
// strategy that yields at least one match. never throws: an unmatched or
// malformed rule resolves to an empty array rather than blocking analysis.
export function resolveField(root: ParentNode, rule: FieldRule): unknown[] {
  const matches = runStrategy(root, rule);
  if (matches.length > 0) {
    return matches;
  }
  if (rule.fallback) {
    return resolveField(root, rule.fallback);
  }
  return [];
}

function runStrategy(root: ParentNode, rule: FieldRule): unknown[] {
  if (rule.strategy === "embedded-json") {
    return runEmbeddedJson(root, rule);
  }
  return runSelector(root, rule);
}

function runEmbeddedJson(root: ParentNode, rule: EmbeddedJsonStrategy): unknown[] {
  const selector = rule.scriptSelector ?? DEFAULT_EMBEDDED_JSON_SELECTOR;
  let scripts: NodeListOf<Element>;
  try {
    scripts = root.querySelectorAll(selector);
  } catch {
    return [];
  }
  for (const script of Array.from(scripts)) {
    const text = script.textContent;
    if (!text) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const matched = queryJsonPath(parsed, rule.path);
    if (matched.length > 0) {
      return matched;
    }
  }
  return [];
}

function runSelector(root: ParentNode, rule: SelectorStrategy): unknown[] {
  let elements: Element[];
  try {
    elements = Array.from(root.querySelectorAll(rule.value));
  } catch {
    return [];
  }
  const values: string[] = [];
  for (const element of elements) {
    const value = extractValue(element, rule.attribute);
    if (value !== null) {
      values.push(value);
    }
  }
  return values;
}

function extractValue(element: Element, attribute?: string): string | null {
  if (attribute) {
    return element.getAttribute(attribute);
  }
  const text = element.textContent;
  return text ? text.trim() : null;
}
