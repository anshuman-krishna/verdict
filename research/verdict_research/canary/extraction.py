import json
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from verdict_research.canary.check import ExtractionOutcome

# check.py explains why extraction is injected rather than reimplemented here: a second, parallel
# python copy of the rules interpreter would put two versions of the thing being watched in the
# repository, one of which nobody ships. This is the adapter that closes that gap by driving the
# real one.
#
# extension/src/canary/cli.ts is bundled to extension/.output/canary/extract.mjs by `just canary-
# extractor`. It reads html on stdin and writes one json object on stdout. One process per page: a
# canary run is a handful of urls already spaced 800ms apart, so the spawn cost is invisible next to
# the fetch it follows.

EXTRACTOR = Path(__file__).resolve().parents[3] / "extension" / ".output" / "canary" / "extract.mjs"


class ExtractorError(RuntimeError):
    pass


@dataclass
class NodeExtractor:
    """extract for canary.check.run_canary, backed by the shipped interpreter."""

    extractor_path: Path = EXTRACTOR
    node: str = "node"
    timeout_seconds: float = 60.0
    # injected so a test can drive this without a built artefact present
    run: Callable[[Sequence[str], str, float], subprocess.CompletedProcess[str]] | None = None

    def __call__(self, html: str, url: str) -> ExtractionOutcome:
        if not self.extractor_path.exists():
            raise ExtractorError(
                f"{self.extractor_path} is missing, run `just canary-extractor` to build it"
            )
        return parse_extractor_output(
            self._invoke([self.node, str(self.extractor_path), url], html)
        )

    def _invoke(self, argv: Sequence[str], html: str) -> str:
        runner = self.run or _run
        completed = runner(argv, html, self.timeout_seconds)
        if completed.returncode != 0:
            raise ExtractorError(completed.stderr.strip() or "the extractor exited non zero")
        return completed.stdout


def _run(argv: Sequence[str], html: str, timeout: float) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            list(argv),
            input=html,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as error:
        raise ExtractorError(f"node is not on the path: {error}") from error
    except subprocess.TimeoutExpired as error:
        raise ExtractorError("the extractor did not finish in time") from error


# a malformed or partial line is an error, never a zero: check.py reads a
# review count of zero as "the page changed and extraction broke", which is
# a claim about amazon, and a broken extractor must not be able to make it.
def parse_extractor_output(stdout: str) -> ExtractionOutcome:
    line = stdout.strip()
    if not line:
        raise ExtractorError("the extractor wrote nothing")
    try:
        data = json.loads(line)
    except json.JSONDecodeError as error:
        raise ExtractorError(f"the extractor wrote something that is not json: {error}") from error
    try:
        return ExtractionOutcome(
            review_count=int(data["reviewCount"]), rules_version=int(data["rulesVersion"])
        )
    except (KeyError, TypeError, ValueError) as error:
        raise ExtractorError(f"the extractor's output is missing a field: {error}") from error
