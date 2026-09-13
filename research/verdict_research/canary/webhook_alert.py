import http.client
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable

TIMEOUT_SECONDS = 10.0
ATTEMPTS = 3
RETRY_DELAYS_SECONDS = (2.0, 5.0)
DISCORD_CONTENT_LIMIT = 2000
SLACK_TEXT_LIMIT = 39000


def _default_post(request: urllib.request.Request) -> object:
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.status


def _stderr(message: str) -> None:
    print(message, file=sys.stderr)


def _truncate(message: str, limit: int) -> str:
    return message if len(message) <= limit else message[: limit - 1] + "…"


def webhook_payload(message: str) -> bytes:
    # slack reads text, discord reads content, each ignores the other
    return json.dumps(
        {
            "text": _truncate(message, SLACK_TEXT_LIMIT),
            "content": _truncate(message, DISCORD_CONTENT_LIMIT),
        }
    ).encode()


def _is_transient(error: Exception) -> bool:
    if isinstance(error, urllib.error.HTTPError):
        return error.code == 429 or error.code >= 500
    return True


def webhook_sender(
    url: str,
    post: Callable[[urllib.request.Request], object] = _default_post,
    warn: Callable[[str], None] = _stderr,
    sleep: Callable[[float], None] = time.sleep,
) -> Callable[[str], None]:
    def send(message: str) -> None:
        request = urllib.request.Request(
            url,
            data=webhook_payload(message),
            headers={"Content-Type": "application/json", "User-Agent": "verdict-canary"},
            method="POST",
        )
        for attempt in range(ATTEMPTS):
            try:
                post(request)
                return
            except (OSError, http.client.HTTPException) as error:
                # a broken alert channel must not fail the canary run itself
                last_attempt = attempt == ATTEMPTS - 1
                if last_attempt or not _is_transient(error):
                    warn(f"canary alert webhook failed after {attempt + 1} attempt(s): {error}")
                    return
                sleep(RETRY_DELAYS_SECONDS[min(attempt, len(RETRY_DELAYS_SECONDS) - 1)])

    return send


def resolve_sender(
    webhook_url: str,
    default: Callable[[str], None] = print,
    warn: Callable[[str], None] = _stderr,
) -> Callable[[str], None]:
    if not webhook_url:
        return default
    if urllib.parse.urlsplit(webhook_url).scheme != "https":
        warn("canary alert webhook ignored, it must be an https url")
        return default
    return webhook_sender(webhook_url, warn=warn)
