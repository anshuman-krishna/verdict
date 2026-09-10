import { bandFromProbability } from "./band";
import { applyModel, MEDIAN_FRACTION, selectModel, signalsFor, type ModelSet } from "./combine";
import type { FeatureVector } from "./featureVector";
import type { Band } from "./report";


export interface StoredScore {
  featureVector?: FeatureVector;
}

export interface Rescored {
  band: Band;
  probability: number;
  unavailableSignals: string[];
}

// no interval, the bootstrap needs reviews
export function rescore(entry: StoredScore, models: ModelSet | null): Rescored | null {
  const vector = entry.featureVector;
  if (vector === undefined || models === null) {
    return null;
  }
  const result = applyModel(vector, selectModel(models, vector), { impute: MEDIAN_FRACTION });
  if (result.status !== "ok") {
    return null;
  }
  return {
    band: bandFromProbability(result.probability),
    probability: result.probability,
    unavailableSignals: signalsFor(result.imputed),
  };
}

export function rescoreAll<T extends StoredScore>(
  entries: readonly T[],
  models: ModelSet | null,
): (T & { rescored: Rescored | null })[] {
  return entries.map((entry) => ({ ...entry, rescored: rescore(entry, models) }));
}
