export interface RatingDeconvolutionResult {
  injectedShare: number;
  residualError: number;
}

// SPEC.md 5.1: observed = (1 - a) * organicPrior + a * injectionKernel, over the
// five star bins. organicPrior and injectionKernel are supplied by the caller,
// this function only fits the scalar mixture weight `a` by constrained least
// squares (a clamped to [0, 1]) and reports the residual as an RMSE.
export function ratingDeconvolution(
  observed: readonly number[],
  organicPrior: readonly number[],
  injectionKernel: readonly number[],
): RatingDeconvolutionResult {
  if (observed.length !== 5 || organicPrior.length !== 5 || injectionKernel.length !== 5) {
    throw new Error("rating deconvolution expects five bin histograms");
  }

  const diff = injectionKernel.map((value, i) => value - (organicPrior[i] ?? 0));
  const residualFromPrior = observed.map((value, i) => value - (organicPrior[i] ?? 0));

  const numerator = sum(diff.map((d, i) => d * (residualFromPrior[i] ?? 0)));
  const denominator = sum(diff.map((d) => d * d));

  const rawA = denominator === 0 ? 0 : numerator / denominator;
  const injectedShare = Math.min(1, Math.max(0, rawA));

  const modeled = organicPrior.map((prior, i) => prior + injectedShare * (diff[i] ?? 0));
  const squaredErrors = observed.map((value, i) => (value - (modeled[i] ?? 0)) ** 2);
  const residualError = Math.sqrt(sum(squaredErrors) / squaredErrors.length);

  return { injectedShare, residualError };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
