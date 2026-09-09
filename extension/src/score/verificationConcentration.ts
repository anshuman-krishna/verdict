export interface ReviewForVerification {
  rating: number | null;
  verified: boolean | null;
  insideBurst: boolean;
}

export interface VerificationConcentrationResult {
  lift: number | null;
  baseCount: number;
}

export function verificationConcentration(
  reviews: readonly ReviewForVerification[],
): VerificationConcentrationResult {
  const known = reviews.filter((review) => review.verified !== null);
  if (known.length === 0) {
    return { lift: null, baseCount: 0 };
  }

  const overallUnverifiedRate = known.filter((review) => review.verified === false).length /
    known.length;

  const stratum = known.filter((review) => review.rating === 5 && review.insideBurst);
  const baseCount = stratum.length;
  if (baseCount === 0 || overallUnverifiedRate === 0) {
    return { lift: null, baseCount };
  }

  const stratumUnverifiedRate = stratum.filter((review) => review.verified === false).length /
    baseCount;

  return { lift: stratumUnverifiedRate / overallUnverifiedRate, baseCount };
}
