from dataclasses import dataclass

# SPEC.md 5.6's last line: "a product's contribution from this signal is the share of its reviews
# written by accounts in high scoring communities". everything upstream of that share, the bipartite
# projection, the disparity filter backbone, the community detection and the community scoring, runs
# on the service (service/verdict_service/graph/) and never in the browser. what arrives here is the
# outcome of SPEC.md section 8's k anonymous lookup: which of these reviewer ids matched a flagged
# community, matched locally, having told the server none of them.
#
# what makes a community flagged is anshuman's (step 4 of 5.6) and is not decided here.


@dataclass(frozen=True)
class ReviewForReviewerGraph:
    reviewer_id: str | None


@dataclass
class ReviewerGraphResult:
    # None when no review carried a reviewer id, which is not the same as none of them being flagged
    flagged_review_share: float | None
    flagged_review_count: int
    flagged_reviewer_count: int
    known_reviewer_count: int
    identified_review_count: int


# per review, not per reviewer: 5.6 asks for the share of the listing's reviews, and one flagged
# account that left eight of them is a different listing from eight accounts leaving one each. both
# counts are reported, since the evidence row says the second and the model reads the first.
def reviewer_graph_share(
    reviews: list[ReviewForReviewerGraph],
    flagged_reviewer_ids: set[str],
) -> ReviewerGraphResult:
    known: set[str] = set()
    flagged_reviewers: set[str] = set()
    identified_review_count = 0
    flagged_review_count = 0

    for review in reviews:
        reviewer_id = review.reviewer_id
        if reviewer_id is None:
            continue
        identified_review_count += 1
        known.add(reviewer_id)
        if reviewer_id in flagged_reviewer_ids:
            flagged_review_count += 1
            flagged_reviewers.add(reviewer_id)

    return ReviewerGraphResult(
        flagged_review_share=(
            None if identified_review_count == 0 else flagged_review_count / identified_review_count
        ),
        flagged_review_count=flagged_review_count,
        flagged_reviewer_count=len(flagged_reviewers),
        known_reviewer_count=len(known),
        identified_review_count=identified_review_count,
    )
