from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from verdict_research.canary.check import CanarySummary, Health

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


def format_alert_message(alerts: list[CanaryAlert]) -> str:
    lines = []
    for alert in alerts:
        was = alert.previous or "no previous run"
        lines.append(f"{alert.site} {alert.locale}: {alert.direction}, {was} to {alert.current}")
    return "\n".join(lines)


def send_alerts(alerts: list[CanaryAlert], send: Callable[[str], None]) -> bool:
    if not alerts:
        return False
    send(format_alert_message(alerts))
    return True
