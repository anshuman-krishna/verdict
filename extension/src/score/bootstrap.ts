// SPEC.md section 6: "bootstrap the feature vector over 200 resamples of
// the extracted review set and report the interquartile range of the
// resulting probability." this is a generic resampler, applicable to
// whatever the combiner eventually produces, since the combiner itself
// waits on ground truth (SPEC.md section 6 and week 4 of PLAN.md).
//
// this runs at analysis time in the extension, not in the research
// pipeline, so unlike the six signals in SPEC.md section 7 it has no
// python mirror and no parity requirement: nothing requires the two
// languages' random resampling to agree with each other.

const DEFAULT_RESAMPLES = 200;

export function resample<T>(items: readonly T[], random: () => number = Math.random): T[] {
  if (items.length === 0) {
    return [];
  }
  const result: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const index = Math.floor(random() * items.length);
    result.push(items[index] as T);
  }
  return result;
}

export interface BootstrapOptions {
  resamples?: number;
  random?: () => number;
}

export function bootstrap<T, R>(
  items: readonly T[],
  compute: (sample: T[]) => R,
  options: BootstrapOptions = {},
): R[] {
  const resamples = options.resamples ?? DEFAULT_RESAMPLES;
  const random = options.random ?? Math.random;
  const results: R[] = [];
  for (let i = 0; i < resamples; i++) {
    results.push(compute(resample(items, random)));
  }
  return results;
}

export interface ConfidenceInterval {
  low: number;
  high: number;
}

// linear interpolation between the two nearest ranks, the method most
// statistics packages (numpy included) use for quartiles by default.
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) {
    return sorted[0] as number;
  }
  const rank = p * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = sorted[lowerIndex] as number;
  const upper = sorted[upperIndex] as number;
  return lower + (upper - lower) * (rank - lowerIndex);
}

export function interquartileRange(values: readonly number[]): ConfidenceInterval {
  if (values.length === 0) {
    return { low: 0, high: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return { low: percentile(sorted, 0.25), high: percentile(sorted, 0.75) };
}
