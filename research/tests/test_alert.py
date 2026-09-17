from verdict_research.canary.alert import (
    CanaryAlert,
    ReadingAlert,
    decide_alerts,
    decide_reading_alerts,
    format_alert_message,
    send_alerts,
)
from verdict_research.canary.check import CanarySummary, FieldReading


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

    def test_stays_quiet_while_a_locale_is_still_broken(self):
        assert decide_alerts([summary("com", "failed")], [summary("com", "failed")]) == []

    def test_stays_quiet_while_a_locale_is_still_healthy(self):
        assert decide_alerts([summary("com", "healthy")], [summary("com", "healthy")]) == []

    def test_alerts_when_degraded_becomes_failed(self):
        alerts = decide_alerts([summary("com", "degraded")], [summary("com", "failed")])
        assert [alert.direction for alert in alerts] == ["worsened"]

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


def reading(field: str, health: str, depth: int = 0, tiers: int = 3) -> FieldReading:
    return FieldReading(field=field, health=health, depth=depth, tiers=tiers)


def summary_with(readings: tuple[FieldReading, ...], rules_version: int = 41) -> CanarySummary:
    return CanarySummary(
        site="amazon",
        locale="com",
        last_verified=1000.0,
        status="healthy",
        rules_version=rules_version,
        median_reviews_extracted=120.0,
        readings=readings,
    )


class TestDecideReadingAlerts:
    def test_alerts_when_a_field_starts_answering_further_down_the_chain(self):
        alerts = decide_reading_alerts(
            [summary_with((reading("reviews", "primary"),))],
            [summary_with((reading("reviews", "last-resort", depth=2),))],
        )
        assert alerts == [
            ReadingAlert(
                site="amazon",
                locale="com",
                field="reviews",
                previous="primary",
                current="last-resort",
            )
        ]

    def test_alerts_when_a_field_stops_answering_at_all(self):
        alerts = decide_reading_alerts(
            [summary_with((reading("title", "fallback"),))],
            [summary_with((reading("title", "missing", depth=-1),))],
        )
        assert [alert.current for alert in alerts] == ["missing"]

    def test_says_nothing_when_a_field_is_read_the_same_way_as_before(self):
        readings = (reading("title", "fallback"), reading("reviews", "primary"))
        assert decide_reading_alerts([summary_with(readings)], [summary_with(readings)]) == []

    def test_says_nothing_when_a_field_recovered(self):
        alerts = decide_reading_alerts(
            [summary_with((reading("title", "last-resort"),))],
            [summary_with((reading("title", "primary"),))],
        )
        assert alerts == []

    # a new ruleset is a new chain, so the depths are not the same measurement
    def test_says_nothing_when_the_rules_changed_between_the_runs(self):
        alerts = decide_reading_alerts(
            [summary_with((reading("title", "primary"),), rules_version=41)],
            [summary_with((reading("title", "missing"),), rules_version=42)],
        )
        assert alerts == []

    def test_says_nothing_about_a_field_the_previous_run_never_read(self):
        alerts = decide_reading_alerts(
            [summary_with(())],
            [summary_with((reading("category", "missing"),))],
        )
        assert alerts == []

    def test_treats_a_health_this_build_does_not_know_as_the_worst(self):
        alerts = decide_reading_alerts(
            [summary_with((reading("title", "missing"),))],
            [summary_with((reading("title", "something newer"),))],
        )
        assert [alert.current for alert in alerts] == ["something newer"]


class TestSendingReadingAlerts:
    def test_sends_a_chain_slip_even_when_no_status_changed(self):
        sent: list[str] = []
        slipped = [
            ReadingAlert(
                site="amazon",
                locale="com",
                field="reviews",
                previous="primary",
                current="fallback",
            )
        ]
        assert send_alerts([], sent.append, slipped) is True
        assert "read further down the chain" in sent[0]
        assert "primary to fallback" in sent[0]

    def test_sends_nothing_when_neither_the_status_nor_the_chain_moved(self):
        sent: list[str] = []
        assert send_alerts([], sent.append, []) is False
        assert sent == []


class TestNamingWhereAFieldIsReadFromNow:
    def test_says_which_serialisation_answered_after_the_slip(self):
        alerts = decide_reading_alerts(
            [summary_with((reading("reviews", "primary"),))],
            [
                summary_with(
                    (
                        FieldReading(
                            field="reviews",
                            health="last-resort",
                            depth=2,
                            tiers=3,
                            strategy="json-records",
                            source="microdata",
                        ),
                    )
                )
            ],
        )
        assert alerts[0].read_from == "microdata"
        assert "now from microdata" in format_alert_message([], alerts)

    def test_falls_back_to_the_strategy_when_no_source_is_recorded(self):
        alerts = decide_reading_alerts(
            [summary_with((reading("title", "primary"),))],
            [
                summary_with(
                    (
                        FieldReading(
                            field="title",
                            health="last-resort",
                            depth=3,
                            tiers=4,
                            strategy="selector",
                        ),
                    )
                )
            ],
        )
        assert "now from selector" in format_alert_message([], alerts)

    def test_says_nothing_extra_when_the_reading_names_neither(self):
        alerts = decide_reading_alerts(
            [summary_with((reading("title", "primary"),))],
            [summary_with((reading("title", "missing", depth=-1),))],
        )
        assert "now from" not in format_alert_message([], alerts)
