from dataclasses import dataclass


@dataclass
class ReviewForVerification:
    rating: int | None
    verified: bool | None
    inside_burst: bool


@dataclass
class VerificationConcentrationResult:
    lift: float | None
    base_count: int


def verification_concentration(
    reviews: list[ReviewForVerification],
) -> VerificationConcentrationResult:
    known = [review for review in reviews if review.verified is not None]
    if not known:
        return VerificationConcentrationResult(lift=None, base_count=0)

    overall_unverified_rate = sum(1 for review in known if review.verified is False) / len(known)

    stratum = [review for review in known if review.rating == 5 and review.inside_burst]
    base_count = len(stratum)
    if base_count == 0 or overall_unverified_rate == 0:
        return VerificationConcentrationResult(lift=None, base_count=base_count)

    stratum_unverified_rate = sum(1 for review in stratum if review.verified is False) / base_count

    return VerificationConcentrationResult(
        lift=stratum_unverified_rate / overall_unverified_rate,
        base_count=base_count,
    )
