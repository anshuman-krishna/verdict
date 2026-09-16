import { queryJsonPath } from "./jsonpath";
import type {
  CompositeStrategy,
  EmbeddedJsonStrategy,
  FieldRule,
  JsonRecordsStrategy,
  NumberFormat,
  PresenceStrategy,
  SelectorStrategy,
} from "./rules";

const DEFAULT_EMBEDDED_JSON_SELECTOR = 'script[type="application/ld+json"]';

export interface StrategyTrace {
  strategy: FieldRule["strategy"];
  depth: number;
  target: string;
  matched: number;
  format: NumberFormat;
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
      format: current.format ?? "locale",
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
    case "json-records":
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
    case "json-records":
      return runJsonRecords(root, rule);
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

function parsedScripts(root: ParentNode, scriptSelector?: string): unknown[] {
  const selector = scriptSelector ?? DEFAULT_EMBEDDED_JSON_SELECTOR;
  let scripts: NodeListOf<Element>;
  try {
    scripts = root.querySelectorAll(selector);
  } catch {
    return [];
  }
  const documents: unknown[] = [];
  for (const script of Array.from(scripts)) {
    const text = script.textContent;
    if (!text) {
      continue;
    }
    try {
      documents.push(JSON.parse(text));
    } catch {
      // a malformed block is one block, not the end of the page
      continue;
    }
  }
  return documents;
}

// a page splits its markup across blocks, so every block is read, not the first that answers
function runEmbeddedJson(root: ParentNode, rule: EmbeddedJsonStrategy): unknown[] {
  return parsedScripts(root, rule.scriptSelector).flatMap((document_) =>
    queryJsonPath(document_, rule.path),
  );
}

function firstJsonValue(node: unknown, paths: string | readonly string[]): unknown {
  for (const path of typeof paths === "string" ? [paths] : paths) {
    const value = queryJsonPath(node, path).find(
      (candidate) => candidate !== null && candidate !== undefined,
    );
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function runJsonRecords(root: ParentNode, rule: JsonRecordsStrategy): unknown[] {
  const records: Record<string, unknown>[] = [];
  for (const document_ of parsedScripts(root, rule.scriptSelector)) {
    for (const node of queryJsonPath(document_, rule.path)) {
      const record: Record<string, unknown> = {};
      let populated = false;
      for (const [name, paths] of Object.entries(rule.fields)) {
        const value = firstJsonValue(node, paths);
        if (value === undefined) {
          continue;
        }
        record[name] = value;
        populated = true;
      }
      if (populated) {
        records.push(record);
      }
    }
  }
  return records;
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
