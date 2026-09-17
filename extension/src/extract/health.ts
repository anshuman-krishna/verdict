import { resolveFieldTraced, type StrategyTrace } from "./interpreter";
import type { FieldRule, RulesDocument } from "./rules";
import { newPageIndex, type PageIndex, type StructuredSource } from "./structuredData";

// SPEC.md section 13: a broken selector falls silently through the chain, so a page
// reads correctly right up until the day it reads nothing at all. how far down the
// chain the answer came from is the warning that arrives before that day.
export type FieldHealth = "primary" | "fallback" | "last-resort" | "missing";

const RANK: Readonly<Record<FieldHealth, number>> = {
  primary: 0,
  fallback: 1,
  "last-resort": 2,
  missing: 3,
};

export function isWorse(current: FieldHealth, previous: FieldHealth): boolean {
  return RANK[current] > RANK[previous];
}

export interface FieldReading {
  field: string;
  health: FieldHealth;
  // which rule in the chain answered, and how many there were. -1 when none did
  depth: number;
  tiers: number;
  strategy: FieldRule["strategy"] | null;
  source: StructuredSource | null;
}

export function chainLength(rule: FieldRule): number {
  let tiers = 0;
  let current: FieldRule | undefined = rule;
  while (current !== undefined) {
    tiers += 1;
    current = current.fallback;
  }
  return tiers;
}

export function readingFor(
  field: string,
  rule: FieldRule,
  trace: readonly StrategyTrace[],
): FieldReading {
  const tiers = chainLength(rule);
  // the chain stops at the rule that answered, so the last step is that rule
  const answered = trace[trace.length - 1];
  if (answered === undefined || answered.matched === 0) {
    return { field, health: "missing", depth: -1, tiers, strategy: null, source: null };
  }
  return {
    field,
    health: healthOf(answered.depth, tiers),
    depth: answered.depth,
    tiers,
    strategy: answered.strategy,
    source: answered.source ?? null,
  };
}

function healthOf(depth: number, tiers: number): FieldHealth {
  if (depth === 0) {
    return "primary";
  }
  return depth >= tiers - 1 ? "last-resort" : "fallback";
}

export function readFields(
  root: ParentNode,
  rules: RulesDocument,
  index: PageIndex = newPageIndex(),
): FieldReading[] {
  return Object.entries(rules.fields).map(([field, rule]) =>
    readingFor(field, rule, resolveFieldTraced(root, rule, index).trace),
  );
}

export function worstHealth(readings: readonly FieldReading[]): FieldHealth {
  let worst: FieldHealth = "primary";
  for (const reading of readings) {
    if (isWorse(reading.health, worst)) {
      worst = reading.health;
    }
  }
  return worst;
}
