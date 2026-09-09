import urllib.error
import urllib.request

import pytest

from verdict_research.canary.fetching import (
    JITTER_SECONDS,
    MIN_SPACING_SECONDS,
    USER_AGENT,
    FetchError,
    PacedFetcher,
)


def fetcher(opener, slept: list[float] | None = None) -> PacedFetcher:
    return PacedFetcher(
        opener=opener,
        sleep=(slept.append if slept is not None else lambda _seconds: None),
        random=lambda: 0.5,
    )


def test_returns_the_decoded_body():
    assert (
        fetcher(lambda request, timeout: b"<html>hi</html>")("https://example.com/a")
        == "<html>hi</html>"
    )


def test_sends_a_user_agent_that_says_what_it_is():
    seen: dict[str, str] = {}

    def opener(request, timeout):
        seen["ua"] = request.get_header("User-agent")
        return b""

    fetcher(opener)("https://example.com/a")
    assert seen["ua"] == USER_AGENT
    assert "verdict" in USER_AGENT


def test_does_not_pause_before_the_first_request():
    slept: list[float] = []
    fetcher(lambda request, timeout: b"", slept)("https://example.com/a")
    assert slept == []


def test_paces_every_request_after_the_first():
    slept: list[float] = []
    paced = fetcher(lambda request, timeout: b"", slept)
    paced("https://example.com/a")
    paced("https://example.com/b")
    paced("https://example.com/c")
    assert len(slept) == 2
    assert all(MIN_SPACING_SECONDS <= s <= MIN_SPACING_SECONDS + JITTER_SECONDS for s in slept)


def test_an_http_error_becomes_a_fetch_error_naming_the_status():
    def opener(request, timeout):
        raise urllib.error.HTTPError("https://example.com/a", 503, "busy", {}, None)

    with pytest.raises(FetchError, match="503"):
        fetcher(opener)("https://example.com/a")


def test_an_unreachable_host_becomes_a_fetch_error():
    def opener(request, timeout):
        raise urllib.error.URLError("no route")

    with pytest.raises(FetchError, match="unreachable"):
        fetcher(opener)("https://example.com/a")


def test_a_timeout_becomes_a_fetch_error():
    def opener(request, timeout):
        raise TimeoutError

    with pytest.raises(FetchError, match="timed out"):
        fetcher(opener)("https://example.com/a")


def test_the_default_opener_refuses_a_plain_http_url():
    with pytest.raises(FetchError, match="https"):
        PacedFetcher(sleep=lambda _s: None)("http://example.com/a")


def test_decodes_invalid_bytes_rather_than_failing_the_check():
    assert fetcher(lambda request, timeout: b"\xff\xfe ok")("https://example.com/a").endswith("ok")
