export const ANALYSIS_BUDGET_MS = 1500;

export interface Measurement {
  label: string;
  durationsMs: number[];
}

export interface BudgetVerdict {
  label: string;
  medianMs: number;
  worstMs: number;
  budgetMs: number;
  withinBudget: boolean;
  headroomMs: number;
}

export function judge(measurement: Measurement, budgetMs: number = ANALYSIS_BUDGET_MS): BudgetVerdict {
  if (measurement.durationsMs.length === 0) {
    throw new Error(`${measurement.label}: nothing was measured`);
  }
  const medianMs = median(measurement.durationsMs);
  return {
    label: measurement.label,
    medianMs,
    worstMs: Math.max(...measurement.durationsMs),
    budgetMs,
    withinBudget: medianMs < budgetMs,
    headroomMs: budgetMs - medianMs,
  };
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] as number;
  }
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export function measure(label: string, runs: number, run: () => void): Measurement {
  const durationsMs: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    run();
    durationsMs.push(performance.now() - started);
  }
  return { label, durationsMs };
}

export function formatVerdict(verdict: BudgetVerdict): string {
  const state = verdict.withinBudget ? "within" : "over";
  return (
    `${verdict.label}: median ${verdict.medianMs.toFixed(0)}ms, worst ${verdict.worstMs.toFixed(0)}ms, ` +
    `${state} the ${verdict.budgetMs}ms budget by ${Math.abs(verdict.headroomMs).toFixed(0)}ms`
  );
}
