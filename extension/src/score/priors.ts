import priors from "../../../schema/priors.json";
import type { FeatureVectorInputs } from "./featureVector";

export const PLACEHOLDER_ORGANIC_PRIOR: readonly number[] = priors.organicPrior;
export const PLACEHOLDER_INJECTION_KERNEL: readonly number[] = priors.injectionKernel;

export const PLACEHOLDER_PRIORS: FeatureVectorInputs = {
  organicPrior: PLACEHOLDER_ORGANIC_PRIOR,
  injectionKernel: PLACEHOLDER_INJECTION_KERNEL,
};
