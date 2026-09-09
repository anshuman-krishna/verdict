export interface ReviewForReviewerGraph {
  reviewerId: string | null;
}

export interface ReviewerGraphResult {
  flaggedReviewShare: number | null;
  flaggedReviewCount: number;
  flaggedReviewerCount: number;
  knownReviewerCount: number;
  identifiedReviewCount: number;
}

export function reviewerGraphShare(
  reviews: readonly ReviewForReviewerGraph[],
  flaggedReviewerIds: ReadonlySet<string>,
): ReviewerGraphResult {
  const known = new Set<string>();
  const flaggedReviewers = new Set<string>();
  let identifiedReviewCount = 0;
  let flaggedReviewCount = 0;

  for (const review of reviews) {
    const id = review.reviewerId;
    if (id === null) {
      continue;
    }
    identifiedReviewCount++;
    known.add(id);
    if (flaggedReviewerIds.has(id)) {
      flaggedReviewCount++;
      flaggedReviewers.add(id);
    }
  }

  return {
    flaggedReviewShare: identifiedReviewCount === 0 ? null : flaggedReviewCount / identifiedReviewCount,
    flaggedReviewCount,
    flaggedReviewerCount: flaggedReviewers.size,
    knownReviewerCount: known.size,
    identifiedReviewCount,
  };
}
