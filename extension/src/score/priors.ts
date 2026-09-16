import document from "../../../schema/priors.json";
import { categoryKeys } from "./categoryKey";
import type { FeatureVectorInputs } from "./featureVector";

export interface PriorPair {
  organicPrior: number[];
  injectionKernel?: number[];
}

export interface PriorsDocument {
  default: { organicPrior: number[]; injectionKernel: number[] };
  aliases: Record<string, string>;
  categories: Record<string, PriorPair>;
}

export const PRIORS_DOCUMENT = document as unknown as PriorsDocument;

export const DEFAULT_ORGANIC_PRIOR: readonly number[] = PRIORS_DOCUMENT.default.organicPrior;
export const DEFAULT_INJECTION_KERNEL: readonly number[] = PRIORS_DOCUMENT.default.injectionKernel;

export const DEFAULT_PRIORS: FeatureVectorInputs = {
  organicPrior: DEFAULT_ORGANIC_PRIOR,
  injectionKernel: DEFAULT_INJECTION_KERNEL,
};

export interface ResolvedPriors {
  inputs: FeatureVectorInputs;
  // which entry answered, so a report can say what it was scored against
  key: string | null;
}

export type PriorsForCategory = (category: string | null) => ResolvedPriors;

const MAX_ALIAS_HOPS = 4;

function followAliases(key: string, source: PriorsDocument): string {
  let current = key;
  for (let hop = 0; hop < MAX_ALIAS_HOPS; hop++) {
    const next = source.aliases[current];
    if (next === undefined || next === current) {
      return current;
    }
    current = next;
  }
  // a cycle in the aliases is a broken document, not a reason to loop
  return current;
}

// SPEC.md 5.1: a kitchen appliance and a paperback have different natural shapes, so
// the narrowest segment of the trail that carries an estimate wins, then its parents
export function resolvePriors(
  category: string | null,
  source: PriorsDocument = PRIORS_DOCUMENT,
): ResolvedPriors {
  for (const candidate of categoryKeys(category)) {
    const key = followAliases(candidate, source);
    const entry = source.categories[key];
    if (entry === undefined) {
      continue;
    }
    return {
      inputs: {
        organicPrior: entry.organicPrior,
        injectionKernel: entry.injectionKernel ?? source.default.injectionKernel,
      },
      key,
    };
  }
  return {
    inputs: {
      organicPrior: source.default.organicPrior,
      injectionKernel: source.default.injectionKernel,
    },
    key: null,
  };
}

export const priorsFor: PriorsForCategory = (category) => resolvePriors(category);
