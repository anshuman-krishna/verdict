import random
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass

MIN_SPACING_SECONDS = 0.8
JITTER_SECONDS = 0.4
DEFAULT_TIMEOUT_SECONDS = 20.0

USER_AGENT = "verdict-canary/0.1 (+https://verdict.tools/status)"


class FetchError(RuntimeError):
    pass


@dataclass
class PacedFetcher:
    """fetch_html for canary.check.run_canary, spaced like the extension is."""

    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    sleep: Callable[[float], None] = time.sleep
    random: Callable[[], float] = random.random
    opener: Callable[[urllib.request.Request, float], bytes] | None = None
    _fetched_any: bool = False

    def __call__(self, url: str) -> str:
        if self._fetched_any:
            self.sleep(MIN_SPACING_SECONDS + self.random() * JITTER_SECONDS)
        self._fetched_any = True

        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            body = (self.opener or _open)(request, self.timeout_seconds)
        except urllib.error.HTTPError as error:
            raise FetchError(f"http {error.code}") from error
        except urllib.error.URLError as error:
            raise FetchError(f"unreachable: {error.reason}") from error
        except TimeoutError as error:
            raise FetchError("timed out") from error
        return body.decode("utf-8", errors="replace")


def _open(request: urllib.request.Request, timeout: float) -> bytes:
    if not request.full_url.startswith("https://"):
        raise FetchError("canary targets must be https")
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - scheme checked above
        return response.read()
