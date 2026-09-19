import math
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from fastapi import HTTPException

from verdict_service.metrics import MetricsRegistry

# deploy/Caddyfile strips the client address before anything reaches this process, on purpose,
# so nothing here can measure one client. these limits are the whole service's, and per client
# limiting belongs in front of it, where the address already is and is already not written down
DEFAULT_REQUESTS_PER_SECOND = 20.0
DEFAULT_BURST_REQUESTS = 120
DEFAULT_MAX_CONCURRENT_REQUESTS = 32

# a wait shorter than this says come back immediately, which is not what a refusal means
MIN_RETRY_AFTER_SECONDS = 1
CONCURRENCY_RETRY_AFTER_SECONDS = 5


@dataclass(frozen=True)
class Shed:
    reason: str
    retry_after_seconds: int


class LoadShedder:
    """a ceiling on what the service will start at once, and on how fast it will start it"""

    def __init__(
        self,
        requests_per_second: float = DEFAULT_REQUESTS_PER_SECOND,
        burst: int = DEFAULT_BURST_REQUESTS,
        max_concurrent: int = DEFAULT_MAX_CONCURRENT_REQUESTS,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self._rate = requests_per_second
        self._burst = float(burst)
        self._max_concurrent = max_concurrent
        self._now = now
        self._tokens = float(burst)
        self._filled_at = now()
        self._in_flight = 0
        self._lock = threading.Lock()

    @property
    def in_flight(self) -> int:
        with self._lock:
            return self._in_flight

    def admit(self) -> Shed | None:
        with self._lock:
            if self._in_flight >= self._max_concurrent:
                return Shed("concurrency", CONCURRENCY_RETRY_AFTER_SECONDS)
            self._refill()
            if self._tokens < 1:
                return Shed("rate", self._seconds_until_a_token())
            self._tokens -= 1
            self._in_flight += 1
            return None

    def release(self) -> None:
        with self._lock:
            self._in_flight = max(0, self._in_flight - 1)

    def _refill(self) -> None:
        now = self._now()
        elapsed = max(0.0, now - self._filled_at)
        self._filled_at = now
        self._tokens = min(self._burst, self._tokens + elapsed * self._rate)

    def _seconds_until_a_token(self) -> int:
        if self._rate <= 0:
            return CONCURRENCY_RETRY_AFTER_SECONDS
        return max(MIN_RETRY_AFTER_SECONDS, math.ceil((1 - self._tokens) / self._rate))


def shed_status(reason: str) -> int:
    # too many requests for the rate, temporarily out of room for the concurrency
    return 429 if reason == "rate" else 503


@contextmanager
def admitted(shedder: LoadShedder, metrics: MetricsRegistry | None = None) -> Iterator[None]:
    shed = shedder.admit()
    if shed is not None:
        if metrics is not None:
            metrics.record_shed(shed.reason)
        raise HTTPException(
            status_code=shed_status(shed.reason),
            detail="busy, try again later",
            headers={"Retry-After": str(shed.retry_after_seconds)},
        )
    try:
        yield
    finally:
        shedder.release()


def load_shedding_dependency(
    shedder: LoadShedder, metrics: MetricsRegistry | None = None
) -> Callable[[], Iterator[None]]:
    def dependency() -> Iterator[None]:
        with admitted(shedder, metrics):
            yield

    return dependency
