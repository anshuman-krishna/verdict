import type { FeatureVectorInputs } from "./featureVector";

// SPEC.md 5.1 says organicPrior is "estimated per product category from the
// negative corpus", and that corpus is PLAN.md week 4, not built yet.
// CLAUDE.md reserves the label corpus and its methodology to anshuman, so
// nothing here invents real per category numbers.
//
// PLACEHOLDER_PRIORS exists only so the pipeline can run end to end before
// that corpus exists. organicPrior is flat (maximally uninformative: every
// star bin equally likely), so injectedShare below measures deviation
// toward the injection kernel and nothing else. injectionKernel follows the
// one line of shape SPEC.md 5.1 actually specifies, "concentrated on four
// and five stars", weighted toward five. Both must be replaced once the
// negative corpus produces real per category priors.
export const PLACEHOLDER_ORGANIC_PRIOR: readonly number[] = [0.2, 0.2, 0.2, 0.2, 0.2];
export const PLACEHOLDER_INJECTION_KERNEL: readonly number[] = [0, 0, 0, 0.35, 0.65];

export const PLACEHOLDER_PRIORS: FeatureVectorInputs = {
  organicPrior: PLACEHOLDER_ORGANIC_PRIOR,
  injectionKernel: PLACEHOLDER_INJECTION_KERNEL,
};
