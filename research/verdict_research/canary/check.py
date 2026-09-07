from collections.abc import Callable
from dataclasses import dataclass
from statistics import median
from typing import Literal

# fetch_html and extract are injected so this owns scheduling, health and aggregation only. a second
# python copy of the rules interpreter would be the thing being watched, written twice

Health = Literal["healthy", "degraded", "failed"]


@dataclass(frozen=True)
class CanaryTarget:
    site: str
    locale: str
    url: str
    # a floor for this page alone, from what extraction has found there. not a signal threshold
    minimum_expected_reviews: int


@dataclass(frozen=True)
class ExtractionOutcome:
    review_count: int
    rules_version: int


@dataclass(frozen=True)
class CanaryResult:
    site: str
    locale: str
    url: str
    checked_at: float
    status: Health
    review_count: int | None
    rules_version: int | None
    error: str | None = None


def _classify(outcome: ExtractionOutcome, target: CanaryTarget) -> Health:
    if outcome.review_count == 0:
        return "failed"
    if outcome.review_count < target.minimum_expected_reviews:
        return "degraded"
    return "healthy"


# never raises: one target failing becomes its own result, so a broken locale cannot hide the others
def run_canary(
    targets: list[CanaryTarget],
    fetch_html: Callable[[str], str],
    extract: Callable[[str, str], ExtractionOutcome],
    now: Callable[[], float],
) -> list[CanaryResult]:
    results: list[CanaryResult] = []
    for target in targets:
        checked_at = now()
        try:
            html = fetch_html(target.url)
            outcome = extract(html, target.url)
        except Exception as error:  # noqa: BLE001 - a canary reports failure, it does not propagate it
            results.append(
                CanaryResult(
                    site=target.site,
                    locale=target.locale,
                    url=target.url,
                    checked_at=checked_at,
                    status="failed",
                    review_count=None,
                    rules_version=None,
                    error=str(error),
                )
            )
            continue

        results.append(
            CanaryResult(
                site=target.site,
                locale=target.locale,
                url=target.url,
                checked_at=checked_at,
                status=_classify(outcome, target),
                review_count=outcome.review_count,
                rules_version=outcome.rules_version,
            )
        )
    return results


@dataclass(frozen=True)
class CanarySummary:
    # SITE.md's /status columns, in order
    site: str
    locale: str
    last_verified: float
    status: Health
    rules_version: int | None
    median_reviews_extracted: float | None


# the median spans every recorded check: a dropping median warns before a run outright fails
def summarize(results: list[CanaryResult]) -> list[CanarySummary]:
    groups: dict[tuple[str, str], list[CanaryResult]] = {}
    for result in results:
        groups.setdefault((result.site, result.locale), []).append(result)

    summaries: list[CanarySummary] = []
    for (site, locale), group in groups.items():
        latest = max(group, key=lambda r: r.checked_at)
        counts = [r.review_count for r in group if r.review_count is not None]
        summaries.append(
            CanarySummary(
                site=site,
                locale=locale,
                last_verified=latest.checked_at,
                status=latest.status,
                rules_version=latest.rules_version,
                median_reviews_extracted=median(counts) if counts else None,
            )
        )
    return sorted(summaries, key=lambda s: (s.site, s.locale))
