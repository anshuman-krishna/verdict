import re
from dataclasses import dataclass
from datetime import UTC, date, datetime

from verdict_research.features.rating_deconvolution import (
    RatingDeconvolutionResult,
    rating_deconvolution,
)
from verdict_research.features.temporal_burst import (
    Burst,
    TemporalBurstResult,
    detect_temporal_bursts,
)
from verdict_research.features.text_near_duplication import (
    ReviewForNearDuplication,
    TextNearDuplicationResult,
    text_near_duplication,
)
from verdict_research.features.verification_concentration import (
    ReviewForVerification,
    VerificationConcentrationResult,
    verification_concentration,
)
from verdict_research.schema import Review

# SPEC.md section 6, "minimum data thresholds". below any of these the
# report says "not enough data" and shows no score at all.
MINIMUM_REVIEW_COUNT = 30
MINIMUM_DATED_REVIEW_COUNT = 20
MINIMUM_HISTORY_DAYS = 21

_EPOCH_ORDINAL = date(1970, 1, 1).toordinal()
_SECONDS_PER_DAY = 86_400
_HAS_EXPLICIT_ZONE = re.compile(r"Z$|[+-]\d{2}:\d{2}$")


# a zone-less datetime string ("2024-03-15T10:00:00") is ambiguous about
# which timezone it means, while a date-only string ("2024-03-15") is not,
# by convention utc midnight. rather than let that ambiguity make this
# function's output depend on the machine's timezone, a datetime with a time
# component must carry an explicit "Z" or offset, and anything else raises.
def day_index(iso: str) -> int:
    if "T" not in iso:
        year, month, day = int(iso[0:4]), int(iso[5:7]), int(iso[8:10])
        return date(year, month, day).toordinal() - _EPOCH_ORDINAL
    if not _HAS_EXPLICIT_ZONE.search(iso):
        raise ValueError(f"day_index requires an explicit time zone on a datetime string: {iso}")
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    epoch_seconds = dt.astimezone(UTC).timestamp()
    return int(epoch_seconds // _SECONDS_PER_DAY)


def meets_minimum_data_thresholds(reviews: list[Review]) -> bool:
    if len(reviews) < MINIMUM_REVIEW_COUNT:
        return False
    dated_days = [day_index(r.date) for r in reviews if r.date is not None]
    if len(dated_days) < MINIMUM_DATED_REVIEW_COUNT:
        return False
    return max(dated_days) - min(dated_days) >= MINIMUM_HISTORY_DAYS


# buckets star ratings 1 through 5 into proportions, matching the five bin
# convention rating_deconvolution's organic_prior and injection_kernel use.
# none when no review carries a rating at all.
def build_rating_histogram(reviews: list[Review]) -> list[float] | None:
    rated = [r for r in reviews if r.rating is not None]
    if not rated:
        return None
    bins = [0, 0, 0, 0, 0]
    for review in rated:
        bin_index = min(5, max(1, round(review.rating))) - 1
        bins[bin_index] += 1
    return [count / len(rated) for count in bins]


@dataclass
class DailyCounts:
    daily_counts: list[int]
    min_day: int


# a dense, gap filled daily series, day 0 being the earliest dated review,
# which is what detect_temporal_bursts expects. none when no review is dated.
def build_daily_counts(reviews: list[Review]) -> DailyCounts | None:
    days = [day_index(r.date) for r in reviews if r.date is not None]
    if not days:
        return None
    min_day, max_day = min(days), max(days)
    daily_counts = [0] * (max_day - min_day + 1)
    for day in days:
        daily_counts[day - min_day] += 1
    return DailyCounts(daily_counts=daily_counts, min_day=min_day)


# whether each review's date falls inside one of the given bursts. a review
# with no date is never inside a burst, since it has no day to place it in.
def derive_inside_burst(reviews: list[Review], min_day: int, bursts: list[Burst]) -> list[bool]:
    result = []
    for review in reviews:
        if review.date is None:
            result.append(False)
            continue
        day = day_index(review.date) - min_day
        result.append(any(b.start_day <= day <= b.end_day for b in bursts))
    return result


@dataclass
class FeatureVectorInputs:
    # per SPEC.md 5.1, estimated per product category from the negative
    # corpus, which does not exist yet. supplied by the caller rather than
    # computed here.
    organic_prior: list[float]
    injection_kernel: list[float]
    window_days: int = 28
    percentile: float = 0.99


@dataclass
class FeatureVector:
    meets_minimum_data: bool
    rating_deconvolution: RatingDeconvolutionResult | None
    temporal_burst: TemporalBurstResult | None
    verification_concentration: VerificationConcentrationResult | None
    text_near_duplication: TextNearDuplicationResult


# wires the four implemented signals against raw extracted reviews. the
# combiner that turns this into a probability and a band does not exist
# yet, that is SPEC.md section 6 and it waits on ground truth.
def build_feature_vector(reviews: list[Review], inputs: FeatureVectorInputs) -> FeatureVector:
    meets_minimum_data = meets_minimum_data_thresholds(reviews)

    histogram = build_rating_histogram(reviews)
    rating_result = (
        rating_deconvolution(histogram, inputs.organic_prior, inputs.injection_kernel)
        if histogram is not None
        else None
    )

    daily = build_daily_counts(reviews)
    temporal_result = (
        detect_temporal_bursts(daily.daily_counts, inputs.window_days, inputs.percentile)
        if daily is not None
        else None
    )

    verification_result = None
    if daily is not None and temporal_result is not None:
        inside_burst = derive_inside_burst(reviews, daily.min_day, temporal_result.bursts)
        verification_result = verification_concentration(
            [
                ReviewForVerification(
                    rating=review.rating, verified=review.verified, inside_burst=inside_burst[i]
                )
                for i, review in enumerate(reviews)
            ]
        )

    duplication_result = text_near_duplication(
        [ReviewForNearDuplication(text=review.text) for review in reviews]
    )

    return FeatureVector(
        meets_minimum_data=meets_minimum_data,
        rating_deconvolution=rating_result,
        temporal_burst=temporal_result,
        verification_concentration=verification_result,
        text_near_duplication=duplication_result,
    )
