import argparse
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from verdict_research.canary.alert import CanaryAlert, decide_alerts, send_alerts
from verdict_research.canary.check import (
    CanaryResult,
    CanarySummary,
    CanaryTarget,
    run_canary,
    summarize,
)
from verdict_research.canary.extraction import NodeExtractor
from verdict_research.canary.fetching import PacedFetcher
from verdict_research.canary.state import (
    DEFAULT_RETAINED_CHECKS,
    prune,
    read_run_history,
    write_run_history,
)
from verdict_research.canary.status_document import (
    build_status_document,
    write_status_document_file,
)
from verdict_research.canary.targets import read_targets

# PLAN.md week 7's canary as one command. Fetch each target, ask the shipped extractor what it
# finds, classify, alert on what changed since last time, and write the document SITE.md's /status
# page renders.
#
# the order matters and is the reason this exists as a single command rather than as four the
# operator sequences: alerts are decided against the summaries from before this run was folded in,
# so a locale that has been broken for a week does not alert again every run.

REPOSITORY = Path(__file__).resolve().parents[3]
DEFAULT_STATUS_OUTPUT = REPOSITORY / "site" / "src" / "data" / "status.json"
DEFAULT_HISTORY = REPOSITORY / "research" / "canary-history.json"


@dataclass(frozen=True)
class CanaryRun:
    results: list[CanaryResult]
    combined: list[CanaryResult]
    current: list[CanarySummary]
    alerts: list[CanaryAlert]


# the ordering that makes the alerting correct, in one place: alerts are
# decided against the summaries from before this run was folded in, so a
# locale that has been broken for a week does not alert again every run.
def run_once(
    targets: list[CanaryTarget],
    history: list[CanaryResult],
    fetch_html: Callable[[str], str],
    extract: Callable[[str, str], object],
    now: Callable[[], float],
    retained_checks: int = DEFAULT_RETAINED_CHECKS,
) -> CanaryRun:
    previous = summarize(history)
    results = run_canary(targets, fetch_html=fetch_html, extract=extract, now=now)
    combined = prune(history + results, retained=retained_checks)
    current = summarize(combined)
    return CanaryRun(
        results=results,
        combined=combined,
        current=current,
        alerts=decide_alerts(previous, current),
    )


def _report(results: list[CanaryResult]) -> None:
    for result in results:
        detail = f"{result.review_count} reviews" if result.review_count is not None else "no read"
        error = f", {result.error}" if result.error else ""
        print(f"{result.site}.{result.locale}: {result.status}, {detail}{error}")


# fetch_html and extract are injectable so the job can be exercised without
# a network or a built extractor bundle. Production passes neither.
def main(
    argv: list[str] | None = None,
    *,
    fetch_html: Callable[[str], str] | None = None,
    extract: Callable[[str, str], object] | None = None,
    now: Callable[[], float] = time.time,
) -> int:
    parser = argparse.ArgumentParser(prog="canary", description="check live extraction health")
    parser.add_argument("targets", help="the targets json file")
    parser.add_argument("--history", default=str(DEFAULT_HISTORY))
    parser.add_argument("--status-output", default=str(DEFAULT_STATUS_OUTPUT))
    parser.add_argument("--retained-checks", type=int, default=DEFAULT_RETAINED_CHECKS)
    parser.add_argument("--timeout", type=float, default=20.0)
    # writing nothing is the right default for a first look at a new target list: a run that has not
    # been reviewed should not be able to change what the public status page says.
    parser.add_argument("--write", action="store_true", help="update the history and status files")
    args = parser.parse_args(argv)

    targets = read_targets(args.targets)
    if not targets:
        print(f"{args.targets} lists no targets", file=sys.stderr)
        return 1

    history = read_run_history(args.history)
    run = run_once(
        targets,
        history,
        fetch_html=fetch_html or PacedFetcher(timeout_seconds=args.timeout),
        extract=extract or NodeExtractor(),
        now=now,
        retained_checks=args.retained_checks,
    )
    _report(run.results)

    # stdout, not a transport. cron mails a job's output, systemd journals
    # it, and a ci step surfaces it, so the honest default is to say it
    # once and let whatever runs this decide where that goes.
    send_alerts(run.alerts, print)

    if not args.write:
        print("nothing written, pass --write to update the status page")
        return 0

    write_run_history(args.history, run.combined)
    write_status_document_file(
        build_status_document(run.current, generated_at=now()), args.status_output
    )
    print(f"wrote {args.status_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
