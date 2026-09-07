import json
from pathlib import Path
from typing import Any

from verdict_research.canary.check import CanaryTarget

# which listings to watch is a data choice, so targets live in a json file and nothing here supplies
# a default. every parse failure is loud: a target skipped quietly is a locale nobody is watching,
# reported as a locale with no problems. canary-targets.example.json shows the shape:
#
#   site                    the storefront, matching rules.json's "site"
#   locale                  the suffix, so com, fr, de or co.uk
#   url                     the listing, https only, stable and long lived
#   minimumExpectedReviews  a positive integer floor for this page alone,
#                           read off what extraction has reliably found
#                           there. Not a signal threshold and not a claim
#                           about any other listing.


class TargetsError(ValueError):
    pass


def parse_targets(raw: str) -> list[CanaryTarget]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise TargetsError(f"not valid json: {error}") from error
    if not isinstance(data, list):
        raise TargetsError("expected a json array of targets")
    return [_target(index, entry) for index, entry in enumerate(data)]


def read_targets(path: str | Path) -> list[CanaryTarget]:
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as error:
        raise TargetsError(f"cannot read {path}: {error}") from error
    return parse_targets(raw)


def _target(index: int, entry: Any) -> CanaryTarget:
    where = f"target {index}"
    if not isinstance(entry, dict):
        raise TargetsError(f"{where}: expected an object")
    site = _string(where, entry, "site")
    locale = _string(where, entry, "locale")
    url = _string(where, entry, "url")
    if not url.startswith("https://"):
        raise TargetsError(f"{where}: url must be https")
    minimum = entry.get("minimumExpectedReviews")
    if not isinstance(minimum, int) or isinstance(minimum, bool) or minimum < 1:
        raise TargetsError(
            f"{where}: minimumExpectedReviews must be a positive integer, "
            "read off what this page has reliably yielded"
        )
    return CanaryTarget(site=site, locale=locale, url=url, minimum_expected_reviews=minimum)


def _string(where: str, entry: dict[str, Any], key: str) -> str:
    value = entry.get(key)
    if not isinstance(value, str) or not value:
        raise TargetsError(f'{where}: "{key}" is required and must be a non empty string')
    return value
