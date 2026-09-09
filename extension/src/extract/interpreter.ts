import { queryJsonPath } from "./jsonpath";
import type {
  CompositeStrategy,
  EmbeddedJsonStrategy,
  FieldRule,
  PresenceStrategy,
  SelectorStrategy,
} from "./rules";

const DEFAULT_EMBEDDED_JSON_SELECTOR = 'script[type="application/ld+json"]';

export interface StrategyTrace {
  strategy: FieldRule["strategy"];
  depth: number;
  target: string;
  matched: number;
}

export interface TracedField {
  values: unknown[];
  trace: StrategyTrace[];
}

export function resolveField(root: ParentNode, rule: FieldRule): unknown[] {
  return resolveFieldTraced(root, rule).values;
}

export function resolveFieldTraced(root: ParentNode, rule: FieldRule): TracedField {
  const trace: StrategyTrace[] = [];
  let current: FieldRule | undefined = rule;
  let depth = 0;
  while (current !== undefined) {
    const values = runStrategy(root, current);
    trace.push({
      strategy: current.strategy,
      depth,
      target: strategyTarget(current),
      matched: values.length,
    });
    if (values.length > 0) {
      return { values, trace };
    }
    current = current.fallback;
    depth += 1;
  }
  return { values: [], trace };
}

function strategyTarget(rule: FieldRule): string {
  switch (rule.strategy) {
    case "embedded-json":
      return rule.path;
    case "composite":
      return rule.container;
    default:
      return rule.value;
  }
}

function runStrategy(root: ParentNode, rule: FieldRule): unknown[] {
  switch (rule.strategy) {
    case "embedded-json":
      return runEmbeddedJson(root, rule);
    case "composite":
      return runComposite(root, rule);
    case "presence":
      return runPresence(root, rule);
    default:
      return runSelector(root, rule);
  }
}

function runComposite(root: ParentNode, rule: CompositeStrategy): unknown[] {
  let containers: Element[];
  try {
    containers = Array.from(root.querySelectorAll(rule.container));
  } catch {
    return [];
  }
  const records: Record<string, unknown>[] = [];
  for (const container of containers) {
    const record: Record<string, unknown> = {};
    let populated = false;
    for (const [name, fieldRule] of Object.entries(rule.fields)) {
      const value = resolveField(container, fieldRule)[0];
      if (value === undefined) {
        continue;
      }
      record[name] = value;
      populated ||= fieldRule.strategy !== "presence" || value === true;
    }
    if (populated) {
      records.push(record);
    }
  }
  return records;
}

function runPresence(root: ParentNode, rule: PresenceStrategy): unknown[] {
  try {
    return [root.querySelector(rule.value) !== null];
  } catch {
    return [false];
  }
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
