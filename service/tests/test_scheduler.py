import pytest

from verdict_service.graph.scheduler import run_periodically


class _StopLoop(Exception):
    pass


async def _run_until_stopped(interval_seconds, job, sleep):
    with pytest.raises(_StopLoop):
        await run_periodically(interval_seconds, job, sleep=sleep)


@pytest.mark.anyio
async def test_runs_the_job_immediately_before_ever_sleeping():
    calls: list[str] = []

    def job() -> None:
        calls.append("job")

    async def sleep(_seconds: float) -> None:
        raise _StopLoop

    await _run_until_stopped(60, job, sleep)

    assert calls == ["job"]


@pytest.mark.anyio
async def test_awaits_an_async_job():
    calls: list[str] = []

    async def job() -> None:
        calls.append("job")

    async def sleep(_seconds: float) -> None:
        raise _StopLoop

    await _run_until_stopped(60, job, sleep)

    assert calls == ["job"]


@pytest.mark.anyio
async def test_a_failing_job_does_not_stop_the_loop():
    calls: list[str] = []

    def job() -> None:
        calls.append("job")
        if len(calls) == 1:
            raise RuntimeError("boom")

    async def sleep(_seconds: float) -> None:
        if len(calls) >= 2:
            raise _StopLoop

    await _run_until_stopped(60, job, sleep)

    assert calls == ["job", "job"]


@pytest.mark.anyio
async def test_sleeps_the_given_interval_between_runs():
    seen_intervals: list[float] = []

    async def sleep(seconds: float) -> None:
        seen_intervals.append(seconds)
        raise _StopLoop

    await _run_until_stopped(3600, lambda: None, sleep)

    assert seen_intervals == [3600]


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
