import json
import sys
import urllib.error
import urllib.request
from collections.abc import Callable

TIMEOUT_SECONDS = 10.0


def _default_post(request: urllib.request.Request) -> object:
    return urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS)


def webhook_sender(
    url: str,
    post: Callable[[urllib.request.Request], object] = _default_post,
    warn: Callable[[str], None] = lambda message: print(message, file=sys.stderr),
) -> Callable[[str], None]:
    # slack and discord incoming webhooks both read this shape
    def send(message: str) -> None:
        request = urllib.request.Request(
            url,
            data=json.dumps({"text": message}).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            post(request)
        except (urllib.error.URLError, TimeoutError) as error:
            # a broken alert channel must not fail the canary run itself
            warn(f"canary alert webhook failed: {error}")

    return send


def resolve_sender(
    webhook_url: str, default: Callable[[str], None] = print
) -> Callable[[str], None]:
    return webhook_sender(webhook_url) if webhook_url else default
