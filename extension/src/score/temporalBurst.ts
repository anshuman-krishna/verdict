export interface Burst {
  startDay: number;
  endDay: number;
  reviewCount: number;
}

export interface TemporalBurstResult {
  bursts: Burst[];
  burstFraction: number;
  burstCount: number;
  largestBurstShare: number;
}

// smallest k such that P(Poisson(lambda) <= k) >= p, via direct cumulative
// summation. fine for the small counts a review timeline produces; lambda=0
// is a degenerate distribution with all mass at 0.
export function poissonQuantile(lambda: number, p: number): number {
  if (lambda === 0) {
    return 0;
  }
  let cdf = Math.exp(-lambda);
  let pmf = cdf;
  let k = 0;
  while (cdf < p) {
    k += 1;
    pmf = (pmf * lambda) / k;
    cdf += pmf;
  }
  return k;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

// SPEC.md 5.2. dailyCounts[i] is the number of reviews that arrived on day i
// of a dense, gap filled daily series. the baseline for day i is the median
// of the windowDays days strictly before it (never including day i itself,
// so a burst is never partly measured against its own count); day 0 has no
// preceding history and is never flagged. adjacent flagged days merge into
// one burst.
export function detectTemporalBursts(
  dailyCounts: readonly number[],
  windowDays = 28,
  percentile = 0.99,
): TemporalBurstResult {
  const flagged = dailyCounts.map((count, i) => {
    if (i === 0) {
      return false;
    }
    const windowStart = Math.max(0, i - windowDays);
    const baseline = median(dailyCounts.slice(windowStart, i));
    return count > poissonQuantile(baseline, percentile);
  });

  const bursts: Burst[] = [];
  let i = 0;
  while (i < flagged.length) {
    if (flagged[i]) {
      const startDay = i;
      let reviewCount = 0;
      while (i < flagged.length && flagged[i]) {
        reviewCount += dailyCounts[i] ?? 0;
        i += 1;
      }
      bursts.push({ startDay, endDay: i - 1, reviewCount });
    } else {
      i += 1;
    }
  }

  const totalReviews = dailyCounts.reduce((total, count) => total + count, 0);
  const reviewsInBursts = bursts.reduce((total, burst) => total + burst.reviewCount, 0);
  const largestBurst = bursts.reduce((max, burst) => Math.max(max, burst.reviewCount), 0);

  return {
    bursts,
    burstFraction: totalReviews === 0 ? 0 : reviewsInBursts / totalReviews,
    burstCount: bursts.length,
    largestBurstShare: totalReviews === 0 ? 0 : largestBurst / totalReviews,
  };
}
