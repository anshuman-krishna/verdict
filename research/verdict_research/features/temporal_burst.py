import math
from dataclasses import dataclass, field


@dataclass
class Burst:
    start_day: int
    end_day: int
    review_count: int


@dataclass
class TemporalBurstResult:
    bursts: list[Burst] = field(default_factory=list)
    burst_fraction: float = 0.0
    burst_count: int = 0
    largest_burst_share: float = 0.0


def poisson_quantile(lam: float, p: float) -> int:
    if lam == 0:
        return 0
    cdf = math.exp(-lam)
    pmf = cdf
    k = 0
    while cdf < p:
        k += 1
        pmf = pmf * lam / k
        cdf += pmf
    return k


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    if n % 2 == 0:
        return (ordered[mid - 1] + ordered[mid]) / 2
    return ordered[mid]


def detect_temporal_bursts(
    daily_counts: list[int],
    window_days: int = 28,
    percentile: float = 0.99,
) -> TemporalBurstResult:
    flagged = []
    for i, count in enumerate(daily_counts):
        if i == 0:
            flagged.append(False)
            continue
        window_start = max(0, i - window_days)
        baseline = _median(daily_counts[window_start:i])
        flagged.append(count > poisson_quantile(baseline, percentile))

    bursts: list[Burst] = []
    i = 0
    while i < len(flagged):
        if flagged[i]:
            start_day = i
            review_count = 0
            while i < len(flagged) and flagged[i]:
                review_count += daily_counts[i]
                i += 1
            bursts.append(Burst(start_day=start_day, end_day=i - 1, review_count=review_count))
        else:
            i += 1

    total_reviews = sum(daily_counts)
    reviews_in_bursts = sum(burst.review_count for burst in bursts)
    largest_burst = max((burst.review_count for burst in bursts), default=0)

    return TemporalBurstResult(
        bursts=bursts,
        burst_fraction=reviews_in_bursts / total_reviews if total_reviews else 0.0,
        burst_count=len(bursts),
        largest_burst_share=largest_burst / total_reviews if total_reviews else 0.0,
    )
