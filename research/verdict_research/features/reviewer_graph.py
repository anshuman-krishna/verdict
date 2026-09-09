from dataclasses import dataclass


@dataclass(frozen=True)
class ReviewForReviewerGraph:
    reviewer_id: str | None


@dataclass
class ReviewerGraphResult:
    flagged_review_share: float | None
    flagged_review_count: int
    flagged_reviewer_count: int
    known_reviewer_count: int
    identified_review_count: int


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
