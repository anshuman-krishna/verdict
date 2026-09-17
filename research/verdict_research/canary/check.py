from collections.abc import Callable
from dataclasses import dataclass
from statistics import median
from typing import Literal

Health = Literal["healthy", "degraded", "failed"]

# extension/src/extract/health.ts writes these, worst last
FieldHealth = Literal["primary", "fallback", "last-resort", "missing"]

_FIELD_HEALTH_RANK: dict[str, int] = {"primary": 0, "fallback": 1, "last-resort": 2, "missing": 3}


def field_health_rank(health: str) -> int:
    # anything a newer extension invents sorts above everything this build knows
    return _FIELD_HEALTH_RANK.get(health, len(_FIELD_HEALTH_RANK))


@dataclass(frozen=True)
class FieldReading:
    field: str
    health: FieldHealth
    depth: int
    tiers: int
    # which rule answered, so an alert can say where the page is being read from now
    strategy: str | None = None
    source: str | None = None


@dataclass(frozen=True)
class CanaryTarget:
    site: str
    locale: str
    url: str
    minimum_expected_reviews: int


@dataclass(frozen=True)
class ExtractionOutcome:
    review_count: int
    rules_version: int
    # SPEC.md section 13: a chain that answered further down than it used to is the
    # warning that arrives before a selector breaks outright
    readings: tuple[FieldReading, ...] = ()


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
    readings: tuple[FieldReading, ...] = ()


def _classify(outcome: ExtractionOutcome, target: CanaryTarget) -> Health:
    if outcome.review_count == 0:
        return "failed"
    if outcome.review_count < target.minimum_expected_reviews:
        return "degraded"
    return "healthy"


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
                readings=outcome.readings,
            )
        )
    return results


@dataclass(frozen=True)
class CanarySummary:
    site: str
    locale: str
    last_verified: float
    status: Health
    rules_version: int | None
    median_reviews_extracted: float | None
    readings: tuple[FieldReading, ...] = ()


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
                readings=latest.readings,
            )
        )
    return sorted(summaries, key=lambda s: (s.site, s.locale))
