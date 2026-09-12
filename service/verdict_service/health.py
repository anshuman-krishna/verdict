import time
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class RecomputeAttempt:
    completed_at: float
    flagged_count: int | None
    error: str | None


class HealthTracker:
    """records the outcome of the most recent recompute run"""

    def __init__(self) -> None:
        self._last: RecomputeAttempt | None = None

    def record_success(self, flagged_count: int, now: Callable[[], float] = time.time) -> None:
        self._last = RecomputeAttempt(completed_at=now(), flagged_count=flagged_count, error=None)

    def record_failure(self, error: Exception, now: Callable[[], float] = time.time) -> None:
        self._last = RecomputeAttempt(completed_at=now(), flagged_count=None, error=str(error))

    @property
    def last(self) -> RecomputeAttempt | None:
        return self._last
