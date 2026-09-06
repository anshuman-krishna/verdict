from verdict_research.canary.alert import (
    CanaryAlert,
    decide_alerts,
    format_alert_message,
    send_alerts,
)
from verdict_research.canary.check import CanarySummary


def summary(locale: str, status: str, last_verified: float = 1000.0) -> CanarySummary:
    return CanarySummary(
        site="amazon",
        locale=locale,
        last_verified=last_verified,
        status=status,
        rules_version=41,
        median_reviews_extracted=120.0,
    )


class TestDecideAlerts:
    # SPEC.md section 13: "selectors broken: ... plus a canary alert to the
    # maintainer."
    def test_alerts_when_a_healthy_locale_starts_failing(self):
        alerts = decide_alerts([summary("com", "healthy")], [summary("com", "failed")])
        assert alerts == [
            CanaryAlert(
                site="amazon", locale="com", previous="healthy", current="failed", direction="broke"
            )
        ]

    def test_alerts_when_a_healthy_locale_degrades(self):
        alerts = decide_alerts([summary("com", "healthy")], [summary("com", "degraded")])
        assert [alert.direction for alert in alerts] == ["broke"]

    # the whole point of comparing against the previous run: a locale that
    # has been broken for a week is already known, and re-sending it every
    # run is how a canary gets filtered out of an inbox.
    def test_stays_quiet_while_a_locale_is_still_broken(self):
        assert decide_alerts([summary("com", "failed")], [summary("com", "failed")]) == []

    def test_stays_quiet_while_a_locale_is_still_healthy(self):
        assert decide_alerts([summary("com", "healthy")], [summary("com", "healthy")]) == []

    def test_alerts_when_degraded_becomes_failed(self):
        alerts = decide_alerts([summary("com", "degraded")], [summary("com", "failed")])
        assert [alert.direction for alert in alerts] == ["worsened"]

    # a partial recovery is not news to somebody who already knows it broke.
    def test_stays_quiet_when_failed_becomes_degraded(self):
        assert decide_alerts([summary("com", "failed")], [summary("com", "degraded")]) == []

    def test_alerts_on_recovery_so_nobody_has_to_poll_the_status_page(self):
        alerts = decide_alerts([summary("com", "failed")], [summary("com", "healthy")])
        assert [alert.direction for alert in alerts] == ["recovered"]

    def test_alerts_when_a_targets_very_first_run_is_already_broken(self):
        alerts = decide_alerts([], [summary("de", "failed")])
        assert alerts == [
            CanaryAlert(
                site="amazon", locale="de", previous=None, current="failed", direction="appeared"
            )
        ]

    def test_stays_quiet_when_a_targets_first_run_is_healthy(self):
        assert decide_alerts([], [summary("de", "healthy")]) == []

    # dropping a target from the list is a deliberate act, not a fault.
    def test_stays_quiet_about_a_target_that_is_no_longer_checked(self):
        assert decide_alerts([summary("com", "healthy")], []) == []

    def test_orders_alerts_by_site_and_locale(self):
        alerts = decide_alerts(
            [],
            [summary("fr", "failed"), summary("co.uk", "failed"), summary("de", "failed")],
        )
        assert [alert.locale for alert in alerts] == ["co.uk", "de", "fr"]


class TestSendAlerts:
    def test_formats_one_line_per_alert(self):
        alerts = decide_alerts(
            [summary("com", "healthy")],
            [summary("com", "failed"), summary("de", "degraded")],
        )
        assert format_alert_message(alerts) == (
            "amazon com: broke, healthy to failed\namazon de: appeared, no previous run to degraded"
        )

    # a layout change breaks every locale at once, and that is one thing
    # that happened, not four.
    def test_sends_a_single_message_for_the_whole_run(self):
        sent = []
        alerts = decide_alerts(
            [], [summary("com", "failed"), summary("de", "failed"), summary("fr", "failed")]
        )
        assert send_alerts(alerts, sent.append) is True
        assert len(sent) == 1

    def test_sends_nothing_when_no_target_changed(self):
        sent = []
        assert send_alerts([], sent.append) is False
        assert sent == []
