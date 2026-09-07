import { queryJsonPath } from "./jsonpath";
import type {
  CompositeStrategy,
  EmbeddedJsonStrategy,
  FieldRule,
  PresenceStrategy,
  SelectorStrategy,
} from "./rules";

const DEFAULT_EMBEDDED_JSON_SELECTOR = 'script[type="application/ld+json"]';

// one entry per strategy actually attempted, in the order they ran. PLAN.md week 1 task 6 asks the
// fixture harness to report "the field and the strategy that ran" on a failure, which is impossible
// from an empty array alone: a field that found nothing and a field with no rule at all look
// identical from outside.
export interface StrategyTrace {
  strategy: FieldRule["strategy"];
  // 0 is the field's own rule, 1 its fallback, and so on down the chain
  depth: number;
  // the json path or selector this step ran, so a report can name it
  // without the reader opening rules.json
  target: string;
  matched: number;
}

export interface TracedField {
  values: unknown[];
  trace: StrategyTrace[];
}

// walks a field's strategy, then its fallback chain, stopping at the first
// strategy that yields at least one match. never throws: an unmatched or
// malformed rule resolves to an empty array rather than blocking analysis.
export function resolveField(root: ParentNode, rule: FieldRule): unknown[] {
  return resolveFieldTraced(root, rule).values;
}

// same walk as resolveField, which delegates here so there is only ever one
// fallback implementation to keep correct.
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

// one record per matched container, each field resolved against that container rather than against
// the page, so two review blocks cannot borrow each other's fields. A container that yields nothing
// for any field is dropped: an empty record is not a review, and keeping it would inflate the count
// SPEC.md section 6's minimum thresholds are measured against.
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
      // a presence rule always answers, including with false, so it is not
      // by itself evidence that this container is a record
      populated ||= fieldRule.strategy !== "presence" || value === true;
    }
    if (populated) {
      records.push(record);
    }
  }
  return records;
}

// always answers, so it never falls through to a fallback: "no badge here"
// is the answer, not a failure to find one.
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
