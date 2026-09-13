import http.client
import io
import json
import urllib.error

import pytest

from verdict_research.canary.webhook_alert import (
    ATTEMPTS,
    DISCORD_CONTENT_LIMIT,
    resolve_sender,
    webhook_payload,
    webhook_sender,
)


def http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("https://hooks.example/x", code, "status", {}, io.BytesIO())


def failing(*errors: Exception):
    remaining = list(errors)
    calls = []

    def post(request):
        calls.append(request)
        if remaining:
            raise remaining.pop(0)

    return post, calls


def sender(post, warnings, sleeps=None):
    return webhook_sender(
        "https://hooks.example/x",
        post=post,
        warn=warnings.append,
        sleep=(sleeps.append if sleeps is not None else lambda _seconds: None),
    )


class TestWebhookSender:
    def test_posts_the_message_as_json_to_the_url(self):
        requests = []
        send = webhook_sender("https://hooks.example/x", post=requests.append)

        send("amazon com: broke, healthy to failed")

        assert len(requests) == 1
        assert requests[0].full_url == "https://hooks.example/x"
        assert requests[0].get_method() == "POST"
        assert requests[0].get_header("Content-type") == "application/json"
        assert json.loads(requests[0].data) == {
            "text": "amazon com: broke, healthy to failed",
            "content": "amazon com: broke, healthy to failed",
        }

    def test_a_long_message_fits_discords_content_limit(self):
        body = json.loads(webhook_payload("x" * 5000))
        assert len(body["content"]) == DISCORD_CONTENT_LIMIT
        assert len(body["text"]) == 5000

    def test_a_timeout_is_retried_and_then_warns_instead_of_raising(self):
        post, calls = failing(*[TimeoutError("timed out")] * ATTEMPTS)
        warnings, sleeps = [], []

        sender(post, warnings, sleeps)("amazon com: broke")

        assert len(calls) == ATTEMPTS
        assert len(sleeps) == ATTEMPTS - 1
        assert len(warnings) == 1
        assert "timed out" in warnings[0]

    def test_a_transient_failure_that_recovers_does_not_warn(self):
        post, calls = failing(http_error(503))
        warnings = []

        sender(post, warnings)("amazon com: broke")

        assert len(calls) == 2
        assert warnings == []

    def test_a_rejected_request_is_not_retried(self):
        post, calls = failing(http_error(404), http_error(404), http_error(404))
        warnings = []

        sender(post, warnings)("amazon com: broke")

        assert len(calls) == 1
        assert len(warnings) == 1

    def test_rate_limiting_is_retried(self):
        post, calls = failing(http_error(429))
        sender(post, [])("amazon com: broke")
        assert len(calls) == 2

    @pytest.mark.parametrize(
        "error",
        [
            urllib.error.URLError("dns failure"),
            ConnectionResetError("reset by peer"),
            http.client.RemoteDisconnected("closed"),
            http.client.BadStatusLine("garbage"),
        ],
    )
    def test_no_network_failure_escapes_to_abort_the_canary_run(self, error):
        post, _calls = failing(*[error] * ATTEMPTS)
        warnings = []

        sender(post, warnings)("amazon com: broke")

        assert len(warnings) == 1


class TestResolveSender:
    def test_an_empty_url_falls_back_to_the_default(self):
        assert resolve_sender("", default=print) is print

    def test_a_url_resolves_to_a_webhook_sender_not_the_default(self):
        assert resolve_sender("https://hooks.example/x", default=print) is not print

    def test_a_plain_http_url_is_refused_so_the_token_never_travels_in_clear(self):
        warnings = []
        assert (
            resolve_sender("http://hooks.example/x", default=print, warn=warnings.append) is print
        )
        assert "https" in warnings[0]
