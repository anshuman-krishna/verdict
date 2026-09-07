import random
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass

# PLAN.md week 7's canary fetches a handful of listing urls that the maintainer chose and watches
# whether extraction still works on them.
#
# this is not the server side page fetching PRIVACY.md section 9 rules out. That rule is about
# fetching a page on a user's behalf, which would mean a user telling a server what they are looking
# at. Nothing here involves a user: the urls are fixed, published in the targets file, and identical
# on every run, so the fetch carries no information about anybody.
#
# the pacing mirrors SPEC.md section 9's own review page fetching: at least 800ms between requests
# with jitter. A monitoring job has no reason to be faster than the product is, and being slower
# than the product costs nothing.

MIN_SPACING_SECONDS = 0.8
JITTER_SECONDS = 0.4
DEFAULT_TIMEOUT_SECONDS = 20.0

# stated plainly rather than disguised as a browser. A canary that has to lie about who it is to
# keep working is measuring something other than what a real browser sees, and the moment that stops
# being true is worth knowing rather than papering over.
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
    # https only. A canary that follows a redirect to plain http would be
    # reporting on a page it did not verify the identity of.
    if not request.full_url.startswith("https://"):
        raise FetchError("canary targets must be https")
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - scheme checked above
        return response.read()
