import json

import pytest

from verdict_research.canary.check import CanaryResult
from verdict_research.canary.state import (
    RUN_HISTORY_VERSION,
    RunHistoryError,
    prune,
    read_run_history,
    write_run_history,
)


def result(site="amazon", locale="com", checked_at=1.0, status="healthy", reviews=30):
    return CanaryResult(
        site=site,
        locale=locale,
        url=f"https://www.amazon.{locale}/dp/B0ABCDEF12",
        checked_at=checked_at,
        status=status,
        review_count=reviews,
        rules_version=41,
    )


def test_a_missing_history_reads_as_empty_not_as_an_error(tmp_path):
    assert read_run_history(tmp_path / "absent.json") == []


def test_round_trips_a_run(tmp_path):
    path = tmp_path / "history.json"
    write_run_history(path, [result(), result(locale="fr", checked_at=2.0)])
    assert read_run_history(path) == [result(), result(locale="fr", checked_at=2.0)]


def test_round_trips_a_failed_check_with_its_error(tmp_path):
    path = tmp_path / "history.json"
    failed = CanaryResult(
        site="amazon",
        locale="de",
        url="https://www.amazon.de/dp/B0ABCDEF12",
        checked_at=3.0,
        status="failed",
        review_count=None,
        rules_version=None,
        error="http 503",
    )
    write_run_history(path, [failed])
    assert read_run_history(path) == [failed]


def test_written_history_sorts_keys_and_ends_in_a_newline(tmp_path):
    path = tmp_path / "history.json"
    write_run_history(path, [result()])
    text = path.read_text(encoding="utf-8")
    assert text.endswith("\n")
    assert json.loads(text)["historyVersion"] == RUN_HISTORY_VERSION


def test_an_unsupported_version_is_refused_rather_than_read(tmp_path):
    path = tmp_path / "history.json"
    path.write_text(json.dumps({"historyVersion": 99, "checks": []}), encoding="utf-8")
    with pytest.raises(RunHistoryError, match="historyVersion"):
        read_run_history(path)


def test_a_corrupt_history_is_an_error_not_an_empty_history(tmp_path):
    path = tmp_path / "history.json"
    path.write_text("{", encoding="utf-8")
    with pytest.raises(RunHistoryError):
        read_run_history(path)


class TestPrune:
    def test_keeps_the_most_recent_checks(self):
        results = [result(checked_at=float(index)) for index in range(10)]
        kept = prune(results, retained=3)
        assert [r.checked_at for r in kept] == [7.0, 8.0, 9.0]

    def test_retains_per_site_and_locale_not_overall(self):
        results = [result(checked_at=float(i)) for i in range(5)]
        results += [result(locale="fr", checked_at=float(i)) for i in range(5)]
        kept = prune(results, retained=3)
        assert len([r for r in kept if r.locale == "com"]) == 3
        assert len([r for r in kept if r.locale == "fr"]) == 3

    def test_keeps_everything_when_under_the_cap(self):
        results = [result(checked_at=float(i)) for i in range(2)]
        assert len(prune(results, retained=30)) == 2

    def test_refuses_a_retention_of_zero(self):
        with pytest.raises(ValueError, match="at least 1"):
            prune([result()], retained=0)
