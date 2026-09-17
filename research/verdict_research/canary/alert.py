from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from verdict_research.canary.check import (
    CanarySummary,
    FieldReading,
    Health,
    field_health_rank,
)

Direction = Literal["broke", "worsened", "recovered", "appeared"]

BROKEN: tuple[Health, ...] = ("degraded", "failed")


@dataclass(frozen=True)
class CanaryAlert:
    site: str
    locale: str
    previous: Health | None
    current: Health
    direction: Direction


def _direction(previous: Health | None, current: Health) -> Direction | None:
    if previous == current:
        return None
    if previous is None:
        return "appeared" if current in BROKEN else None
    if previous == "healthy":
        return "broke"
    if current == "healthy":
        return "recovered"
    return "worsened" if current == "failed" else None


def decide_alerts(previous: list[CanarySummary], current: list[CanarySummary]) -> list[CanaryAlert]:
    previous_by_target = {(row.site, row.locale): row for row in previous}
    alerts = []
    for row in current:
        was = previous_by_target.get((row.site, row.locale))
        direction = _direction(was.status if was else None, row.status)
        if direction is not None:
            alerts.append(
                CanaryAlert(
                    site=row.site,
                    locale=row.locale,
                    previous=was.status if was else None,
                    current=row.status,
                    direction=direction,
                )
            )
    return sorted(alerts, key=lambda alert: (alert.site, alert.locale))


# SPEC.md section 13: the fallback chain hides a broken selector, so a field that
# started answering further down is the last warning before it answers nowhere
@dataclass(frozen=True)
class ReadingAlert:
    site: str
    locale: str
    field: str
    previous: str
    current: str
    read_from: str | None = None


def _by_field(readings: tuple[FieldReading, ...]) -> dict[str, FieldReading]:
    return {reading.field: reading for reading in readings}


def decide_reading_alerts(
    previous: list[CanarySummary], current: list[CanarySummary]
) -> list[ReadingAlert]:
    previous_by_target = {(row.site, row.locale): row for row in previous}
    alerts = []
    for row in current:
        was = previous_by_target.get((row.site, row.locale))
        # a different ruleset is a different chain, so the depths are not comparable
        if was is None or was.rules_version != row.rules_version:
            continue
        before = _by_field(was.readings)
        for field, reading in _by_field(row.readings).items():
            earlier = before.get(field)
            if earlier is None:
                continue
            if field_health_rank(reading.health) > field_health_rank(earlier.health):
                alerts.append(
                    ReadingAlert(
                        site=row.site,
                        locale=row.locale,
                        field=field,
                        previous=earlier.health,
                        current=reading.health,
                        read_from=reading.source or reading.strategy,
                    )
                )
    return sorted(alerts, key=lambda alert: (alert.site, alert.locale, alert.field))


def format_alert_message(
    alerts: list[CanaryAlert], readings: list[ReadingAlert] | None = None
) -> str:
    lines = []
    for alert in alerts:
        was = alert.previous or "no previous run"
        lines.append(f"{alert.site} {alert.locale}: {alert.direction}, {was} to {alert.current}")
    for reading in readings or []:
        where = f", now from {reading.read_from}" if reading.read_from else ""
        lines.append(
            f"{reading.site} {reading.locale}: {reading.field} is being read further down "
            f"the chain, {reading.previous} to {reading.current}{where}"
        )
    return "\n".join(lines)


def send_alerts(
    alerts: list[CanaryAlert],
    send: Callable[[str], None],
    readings: list[ReadingAlert] | None = None,
) -> bool:
    if not alerts and not readings:
        return False
    send(format_alert_message(alerts, readings))
    return True
