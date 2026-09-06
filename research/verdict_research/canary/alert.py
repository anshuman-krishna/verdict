from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from verdict_research.canary.check import CanarySummary, Health

# SPEC.md section 13's failure table, the row that has no code behind it:
# "selectors broken: silent fallback chain, then [not enough data], plus a
# canary alert to the maintainer." check.py already classifies health per
# site and locale; this decides which of those classifications are worth
# waking somebody for.
#
# Only transitions alert. A locale that has been failing for a week is
# already known, and re-sending it every run is how a canary becomes
# something its maintainer filters out of their inbox, which is worse than
# not having one. Recoveries are sent too, for the same reason in reverse:
# whoever was told it broke should not have to poll the status page to find
# out it stopped.
#
# Transport is injected. Where an alert goes (email, a webhook, a phone) is
# a deployment decision, and one that needs credentials this repository does
# not hold.

Direction = Literal["broke", "worsened", "recovered", "appeared"]

BROKEN: tuple[Health, ...] = ("degraded", "failed")


@dataclass(frozen=True)
class CanaryAlert:
    site: str
    locale: str
    previous: Health | None
    current: Health
    # "broke", "worsened", "recovered", or "appeared" for a target whose
    # first ever run was already unhealthy.
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
    # degraded to failed is worth sending, failed to degraded is a partial
    # recovery and is not: the maintainer already knows this one is broken.
    return "worsened" if current == "failed" else None


# compares the run that just finished against the last one, by site and
# locale. A target present in the previous run and absent from this one is
# not alerted on: that means somebody removed it from the target list, which
# is a deliberate act, not a fault.
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


# sends at most one message per run rather than one per alert, so a layout
# change that breaks all four locales at once is one notification.
def send_alerts(alerts: list[CanaryAlert], send: Callable[[str], None]) -> bool:
    if not alerts:
        return False
    send(format_alert_message(alerts))
    return True
