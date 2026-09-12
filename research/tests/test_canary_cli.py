import json

from verdict_research.canary.check import CanaryResult, ExtractionOutcome
from verdict_research.canary.cli import main, run_once
from verdict_research.canary.state import write_run_history
from verdict_research.canary.targets import parse_targets

TARGETS = """
[
  {"site": "amazon", "locale": "com", "url": "https://www.amazon.com/dp/B0ABCDEF12",
   "minimumExpectedReviews": 20},
  {"site": "amazon", "locale": "fr", "url": "https://www.amazon.fr/dp/B0ABCDEF12",
   "minimumExpectedReviews": 20}
]
"""


def targets_file(tmp_path, raw: str = TARGETS) -> str:
    path = tmp_path / "targets.json"
    path.write_text(raw, encoding="utf-8")
    return str(path)


def healthy_extract(html: str, url: str) -> ExtractionOutcome:
    return ExtractionOutcome(review_count=30, rules_version=41)


def broken_extract(html: str, url: str) -> ExtractionOutcome:
    return ExtractionOutcome(review_count=0, rules_version=41)


def clock(start: float = 1000.0):
    state = {"now": start}

    def now() -> float:
        state["now"] += 1
        return state["now"]

    return now


class TestRunOnce:
    def test_checks_every_target(self):
        run = run_once(
            parse_targets(TARGETS), [], lambda url: "<html></html>", healthy_extract, clock()
        )
        assert len(run.results) == 2
        assert {r.locale for r in run.results} == {"com", "fr"}

    def test_a_first_healthy_run_alerts_about_nothing(self):
        run = run_once(
            parse_targets(TARGETS), [], lambda url: "<html></html>", healthy_extract, clock()
        )
        assert run.alerts == []

    def test_a_first_broken_run_alerts(self):
        run = run_once(
            parse_targets(TARGETS), [], lambda url: "<html></html>", broken_extract, clock()
        )
        assert len(run.alerts) == 2

    def test_a_locale_broken_again_does_not_alert_twice(self):
        now = clock()
        targets = parse_targets(TARGETS)
        first = run_once(targets, [], lambda url: "<html></html>", broken_extract, now)
        assert first.alerts

        second = run_once(targets, first.combined, lambda url: "<html></html>", broken_extract, now)
        assert second.alerts == []

    def test_a_recovery_alerts(self):
        now = clock()
        targets = parse_targets(TARGETS)
        broken = run_once(targets, [], lambda url: "<html></html>", broken_extract, now)
        recovered = run_once(
            targets, broken.combined, lambda url: "<html></html>", healthy_extract, now
        )
        assert len(recovered.alerts) == 2

    def test_a_fetch_failure_becomes_that_target_and_does_not_abort_the_rest(self):
        def fetch(url: str) -> str:
            if "amazon.fr" in url:
                raise RuntimeError("http 503")
            return "<html></html>"

        run = run_once(parse_targets(TARGETS), [], fetch, healthy_extract, clock())
        by_locale = {r.locale: r for r in run.results}
        assert by_locale["fr"].status == "failed"
        assert by_locale["com"].status == "healthy"

    def test_the_history_is_pruned(self):
        targets = parse_targets(TARGETS)
        now = clock()
        history: list[CanaryResult] = []
        for _ in range(6):
            history = run_once(
                targets, history, lambda url: "<html></html>", healthy_extract, now, 3
            ).combined
        assert len(history) == 6


class TestMain:
    def test_writes_nothing_without_the_write_flag(self, tmp_path, capsys):
        status = tmp_path / "status.json"
        code = main(
            [
                targets_file(tmp_path),
                "--history",
                str(tmp_path / "h.json"),
                "--status-output",
                str(status),
            ],
            fetch_html=lambda url: "<html></html>",
            extract=healthy_extract,
            now=clock(),
        )
        assert code == 0
        assert not status.exists()
        assert "nothing written" in capsys.readouterr().out

    def test_writes_the_status_document_and_the_history_with_the_flag(self, tmp_path):
        status = tmp_path / "status.json"
        history = tmp_path / "h.json"
        code = main(
            [
                targets_file(tmp_path),
                "--history",
                str(history),
                "--status-output",
                str(status),
                "--write",
            ],
            fetch_html=lambda url: "<html></html>",
            extract=healthy_extract,
            now=clock(),
        )
        assert code == 0
        document = json.loads(status.read_text(encoding="utf-8"))
        assert {row["locale"] for row in document["rows"]} == {"com", "fr"}
        assert all(row["status"] == "healthy" for row in document["rows"])
        assert history.exists()

    def test_reports_each_target_on_stdout(self, tmp_path, capsys):
        main(
            [targets_file(tmp_path), "--history", str(tmp_path / "h.json")],
            fetch_html=lambda url: "<html></html>",
            extract=broken_extract,
            now=clock(),
        )
        out = capsys.readouterr().out
        assert "amazon.com: failed" in out
        assert "amazon.fr: failed" in out

    def test_refuses_an_empty_targets_file(self, tmp_path, capsys):
        code = main(
            [targets_file(tmp_path, "[]"), "--history", str(tmp_path / "h.json")],
            fetch_html=lambda url: "<html></html>",
            extract=healthy_extract,
        )
        assert code == 1
        assert "no targets" in capsys.readouterr().err

    def test_alerts_go_to_the_injected_sender_over_stdout(self, tmp_path, capsys):
        sent = []
        main(
            [targets_file(tmp_path), "--history", str(tmp_path / "h.json")],
            fetch_html=lambda url: "<html></html>",
            extract=broken_extract,
            now=clock(),
            send=sent.append,
        )
        assert len(sent) == 1
        assert "amazon com" not in capsys.readouterr().out

    def test_an_alert_webhook_flag_reaches_the_alert_sender(self, tmp_path, monkeypatch):
        posted = []
        monkeypatch.setattr(
            "verdict_research.canary.cli.resolve_sender",
            lambda url: posted.append(url) or (lambda message: posted.append(message)),
        )
        main(
            [
                targets_file(tmp_path),
                "--history",
                str(tmp_path / "h.json"),
                "--alert-webhook",
                "https://hooks.example/x",
            ],
            fetch_html=lambda url: "<html></html>",
            extract=broken_extract,
            now=clock(),
        )
        assert posted[0] == "https://hooks.example/x"

    def test_the_alert_webhook_env_var_is_the_flags_default(self, tmp_path, monkeypatch):
        monkeypatch.setenv("VERDICT_CANARY_ALERT_WEBHOOK", "https://hooks.example/env")
        posted = []
        monkeypatch.setattr(
            "verdict_research.canary.cli.resolve_sender",
            lambda url: posted.append(url) or (lambda message: None),
        )
        main(
            [targets_file(tmp_path), "--history", str(tmp_path / "h.json")],
            fetch_html=lambda url: "<html></html>",
            extract=healthy_extract,
            now=clock(),
        )
        assert posted == ["https://hooks.example/env"]

    def test_carries_an_existing_history_forward(self, tmp_path):
        history = tmp_path / "h.json"
        write_run_history(
            history,
            [
                CanaryResult(
                    site="amazon",
                    locale="com",
                    url="https://www.amazon.com/dp/B0ABCDEF12",
                    checked_at=1.0,
                    status="healthy",
                    review_count=50,
                    rules_version=41,
                )
            ],
        )
        status = tmp_path / "status.json"
        main(
            [
                targets_file(tmp_path),
                "--history",
                str(history),
                "--status-output",
                str(status),
                "--write",
            ],
            fetch_html=lambda url: "<html></html>",
            extract=healthy_extract,
            now=clock(),
        )
        row = next(
            r
            for r in json.loads(status.read_text(encoding="utf-8"))["rows"]
            if r["locale"] == "com"
        )
        assert row["medianReviewsExtracted"] == 40
