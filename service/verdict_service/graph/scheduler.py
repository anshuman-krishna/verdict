import asyncio
import logging
from collections.abc import Awaitable, Callable

logger = logging.getLogger("verdict_service.scheduler")


async def run_periodically(
    interval_seconds: float,
    job: Callable[[], Awaitable[None] | None],
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    """Runs job, waits interval_seconds, and repeats, forever.

    Sleeps first would delay the first run by a full interval for no
    reason; running first means a freshly started process does not wait
    interval_seconds before its flagged set reflects whatever contribution
    store it starts with.

    A single failing run is logged and never propagates: main.py's own
    on_event("startup") task is this loop's only caller, and an
    unhandled exception there would silently stop every future recompute
    and prune with no user facing symptom until someone happens to check
    the graph, the same reasoning extension/src/entrypoints/background.ts
    applies to flushDueContributions.
    """
    while True:
        try:
            result = job()
            if result is not None:
                await result
        except Exception:
            logger.exception("scheduled job failed, will retry after %s seconds", interval_seconds)
        await sleep(interval_seconds)
