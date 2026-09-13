import time
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class RecomputeAttempt:
    completed_at: float
    flagged_count: int | None
    error: str | None


@dataclass(frozen=True)
class BackupAttempt:
    completed_at: float
    path: str | None
    error: str | None


class HealthTracker:
    """records the outcome of the most recent recompute and backup runs"""

    def __init__(self) -> None:
        self._last_recompute: RecomputeAttempt | None = None
        self._last_backup: BackupAttempt | None = None

    def record_success(self, flagged_count: int, now: Callable[[], float] = time.time) -> None:
        self._last_recompute = RecomputeAttempt(
            completed_at=now(), flagged_count=flagged_count, error=None
        )

    def record_failure(self, error: Exception, now: Callable[[], float] = time.time) -> None:
        self._last_recompute = RecomputeAttempt(
            completed_at=now(), flagged_count=None, error=str(error)
        )

    def record_backup_success(self, path: str, now: Callable[[], float] = time.time) -> None:
        self._last_backup = BackupAttempt(completed_at=now(), path=path, error=None)

    def record_backup_failure(self, error: Exception, now: Callable[[], float] = time.time) -> None:
        self._last_backup = BackupAttempt(completed_at=now(), path=None, error=str(error))

    @property
    def last(self) -> RecomputeAttempt | None:
        return self._last_recompute

    @property
    def last_backup(self) -> BackupAttempt | None:
        return self._last_backup
