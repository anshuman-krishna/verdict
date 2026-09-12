import json
import urllib.error

from verdict_research.canary.webhook_alert import resolve_sender, webhook_sender


class TestWebhookSender:
    def test_posts_the_message_as_json_to_the_url(self):
        requests = []
        send = webhook_sender("https://hooks.example/x", post=requests.append)

        send("amazon com: broke, healthy to failed")

        assert len(requests) == 1
        assert requests[0].full_url == "https://hooks.example/x"
        assert requests[0].get_header("Content-type") == "application/json"
        assert json.loads(requests[0].data) == {"text": "amazon com: broke, healthy to failed"}

    def test_a_failed_post_warns_instead_of_raising(self):
        def failing_post(request):
            raise TimeoutError("timed out")

        warnings = []
        send = webhook_sender("https://hooks.example/x", post=failing_post, warn=warnings.append)

        send("amazon com: broke, healthy to failed")

        assert len(warnings) == 1
        assert "timed out" in warnings[0]

    def test_a_url_error_also_warns_instead_of_raising(self):
        def failing_post(request):
            raise urllib.error.URLError("dns failure")

        warnings = []
        send = webhook_sender("https://hooks.example/x", post=failing_post, warn=warnings.append)

        send("amazon com: broke, healthy to failed")

        assert len(warnings) == 1


class TestResolveSender:
    def test_an_empty_url_falls_back_to_the_default(self):
        assert resolve_sender("", default=print) is print

    def test_a_url_resolves_to_a_webhook_sender_not_the_default(self):
        assert resolve_sender("https://hooks.example/x", default=print) is not print
