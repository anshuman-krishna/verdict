from collections.abc import Callable
from dataclasses import dataclass
from statistics import median
from typing import Literal

# PLAN.md week 7: "reliability, canaries, remote rules, size budget". The
# site's /status page already names this module and says plainly that
# nothing behind it exists yet; this is that job's core, not yet wired to
# a scheduler or a real fetch.
#
# The actual extraction rules interpreter lives in extension/src/extract/
# (TypeScript), and PLAN.md never asks for a second, parallel Python
# implementation of it, only a Python job that watches whether the real
# one still works against live pages. Re-implementing selector and
# embedded-json extraction here would be exactly the "plausible wrong
# code" PLAN.md warns about for that module, doubled. So fetch_html and
# extract are both injected: this file owns the scheduling, the health
# classification, and the aggregation the status page needs, and stays
# agnostic about how a page becomes a review count. Wiring extract to the
# real interpreter (most plausibly by shelling out to a small node script
# that imports it) is future work, not a decision this module makes.

Health = Literal["healthy", "degraded", "failed"]


@dataclass(frozen=True)
class CanaryTarget:
    site: str
    locale: str
    url: str
    # a floor specific to this one canary page, set by whoever adds it,
    # from what extraction has reliably found there before. Not a signal
    # threshold and not a claim about any other listing, just "this page
    # dropping below this is itself the anomaly worth a look."
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


# runs every target once. Never raises: a fetch or extract failure on one
# target becomes that target's "failed" result rather than aborting the
# rest of the run, so one broken locale does not hide the others.
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
    # the status page's table, one row per site and locale: SITE.md's
    # columns are last verified, extraction health, rules version, and
    # median reviews extracted, in that order.
    site: str
    locale: str
    last_verified: float
    status: Health
    rules_version: int | None
    median_reviews_extracted: float | None


# groups a run history by (site, locale) and reduces it to one row per
# group: the most recent check's status and rules version, and the median
# review count across every recorded check, healthy or not, since a
# dropping median is itself an early warning even before a run outright
# fails.
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
