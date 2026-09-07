import json
from pathlib import Path
from typing import Any

from verdict_research.canary.check import CanaryResult

# summarize() in check.py takes a run history, not a single run, because the median review count
# across recent checks is an early warning that a dropping page gives before it outright fails. That
# history has to survive between runs, so this is where it lives.
#
# bounded on purpose. A file that grows forever is a file somebody eventually deletes, and losing
# the whole history to reclaim disk is worse than never having kept more than a month of it.

RUN_HISTORY_VERSION = 1
DEFAULT_RETAINED_CHECKS = 30


class RunHistoryError(ValueError):
    pass


def read_run_history(path: str | Path) -> list[CanaryResult]:
    file = Path(path)
    if not file.exists():
        return []
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise RunHistoryError(f"{path} is not valid json: {error}") from error
    version = data.get("historyVersion") if isinstance(data, dict) else None
    if version != RUN_HISTORY_VERSION:
        raise RunHistoryError(f"{path} has unsupported historyVersion {version!r}")
    return [_result(entry) for entry in data.get("checks", [])]


def write_run_history(path: str | Path, results: list[CanaryResult]) -> None:
    document: dict[str, Any] = {
        "historyVersion": RUN_HISTORY_VERSION,
        "checks": [
            {
                "site": result.site,
                "locale": result.locale,
                "url": result.url,
                "checkedAt": result.checked_at,
                "status": result.status,
                "reviewCount": result.review_count,
                "rulesVersion": result.rules_version,
                "error": result.error,
            }
            for result in results
        ],
    }
    Path(path).write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")


# keeps the most recent checks per site and locale rather than the most recent checks overall, so
# adding a locale does not push every other locale's history out.
def prune(
    results: list[CanaryResult], retained: int = DEFAULT_RETAINED_CHECKS
) -> list[CanaryResult]:
    if retained < 1:
        raise ValueError("retained must be at least 1")
    groups: dict[tuple[str, str], list[CanaryResult]] = {}
    for result in results:
        groups.setdefault((result.site, result.locale), []).append(result)
    kept: list[CanaryResult] = []
    for group in groups.values():
        kept.extend(sorted(group, key=lambda r: r.checked_at)[-retained:])
    return sorted(kept, key=lambda r: (r.site, r.locale, r.checked_at))


def _result(entry: Any) -> CanaryResult:
    if not isinstance(entry, dict):
        raise RunHistoryError("expected an object per check")
    try:
        return CanaryResult(
            site=str(entry["site"]),
            locale=str(entry["locale"]),
            url=str(entry["url"]),
            checked_at=float(entry["checkedAt"]),
            status=entry["status"],
            review_count=entry["reviewCount"],
            rules_version=entry["rulesVersion"],
            error=entry.get("error"),
        )
    except (KeyError, TypeError, ValueError) as error:
        raise RunHistoryError(f"a stored check is missing a field: {error}") from error
