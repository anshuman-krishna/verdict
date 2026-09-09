import { bandFromProbability } from "./band";
import { applyModel, selectModel, type ModelSet } from "./combine";
import type { FeatureVector } from "./featureVector";
import type { Band } from "./report";

// SPEC.md section 10's stored vector, scored again.
// no interval: the bootstrap needs the reviews.

export interface StoredScore {
  featureVector?: FeatureVector;
}

export interface Rescored {
  band: Band;
  probability: number;
}

export function rescore(entry: StoredScore, models: ModelSet | null): Rescored | null {
  const vector = entry.featureVector;
  if (vector === undefined || models === null) {
    return null;
  }
  const result = applyModel(vector, selectModel(models, vector));
  if (result.status !== "ok") {
    return null;
  }
  return { band: bandFromProbability(result.probability), probability: result.probability };
}

// an unscorable entry is kept, not dropped
export function rescoreAll<T extends StoredScore>(
  entries: readonly T[],
  models: ModelSet | null,
): (T & { rescored: Rescored | null })[] {
  return entries.map((entry) => ({ ...entry, rescored: rescore(entry, models) }));
}
