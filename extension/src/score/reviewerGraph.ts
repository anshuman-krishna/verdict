// SPEC.md 5.6's last line: "a product's contribution from this signal is the share of its reviews
// written by accounts in high scoring communities". everything upstream of that share, the
// bipartite projection, the disparity filter backbone, the community detection and the community
// scoring, runs on the service (service/verdict_service/graph/) and never in the browser. what
// arrives here is the outcome of SPEC.md section 8's k anonymous lookup: which of these reviewer
// ids matched a flagged community, matched locally, having told the server none of them.
//
// what makes a community flagged is anshuman's (step 4 of 5.6) and is not decided here.

export interface ReviewForReviewerGraph {
  reviewerId: string | null;
}

export interface ReviewerGraphResult {
  // null when no review carried a reviewer id, which is not the same as none of them being flagged
  flaggedReviewShare: number | null;
  flaggedReviewCount: number;
  flaggedReviewerCount: number;
  knownReviewerCount: number;
  identifiedReviewCount: number;
}

// per review, not per reviewer: 5.6 asks for the share of the listing's reviews, and one flagged
// account that left eight of them is a different listing from eight accounts leaving one each.
// both counts are reported, since the evidence row says the second and the model reads the first.
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
