import json
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from verdict_research.canary.check import ExtractionOutcome
from verdict_research.schema import (
    ProductSnapshot,
    Review,
    product_snapshot_from_json,
    review_from_json,
)

# canary/check.py explains why extraction is injected rather than reimplemented in python: a second,
# parallel copy of the rules interpreter would put two versions of the thing being watched in the
# repository, one of which nobody ships. This is the adapter that closes that gap by driving the
# real one, for the canary and for the corpus builder both.
#
# extension/src/canary/cli.ts is bundled to extension/.output/canary/extract.mjs by `just canary-
# extractor`. It reads html on stdin and writes one json object on stdout. One process per page: a
# canary run is a handful of urls already spaced 800ms apart, and a corpus run is forty saved pages,
# so the spawn cost is invisible next to what it follows.

EXTRACTOR = Path(__file__).resolve().parents[2] / "extension" / ".output" / "canary" / "extract.mjs"

Runner = Callable[[Sequence[str], str, float], subprocess.CompletedProcess[str]]


class ExtractorError(RuntimeError):
    pass


@dataclass(frozen=True)
class FullExtraction:
    url: str
    site: str | None
    locale: str | None
    rules_version: int
    review_count: int
    title: str | None
    product: ProductSnapshot | None
    reviews: list[Review]


@dataclass
class _NodeBridge:
    extractor_path: Path = EXTRACTOR
    node: str = "node"
    timeout_seconds: float = 60.0
    # injected so a test can drive this without a built artefact present
    run: Runner | None = None

    def invoke(self, url: str, html: str, extra: Sequence[str] = ()) -> str:
        if not self.extractor_path.exists():
            raise ExtractorError(
                f"{self.extractor_path} is missing, run `just canary-extractor` to build it"
            )
        argv = [self.node, str(self.extractor_path), *extra, url]
        runner = self.run or _run
        completed = runner(argv, html, self.timeout_seconds)
        if completed.returncode != 0:
            raise ExtractorError(completed.stderr.strip() or "the extractor exited non zero")
        return completed.stdout


@dataclass
class NodeExtractor(_NodeBridge):
    """extract for canary.check.run_canary, backed by the shipped interpreter."""

    def __call__(self, html: str, url: str) -> ExtractionOutcome:
        return parse_extractor_output(self.invoke(url, html))


@dataclass
class NodeReviewExtractor(_NodeBridge):
    """extract for corpus.featurise, the same interpreter asked for the reviews as well."""

    def __call__(self, html: str, url: str) -> FullExtraction:
        return parse_full_extractor_output(self.invoke(url, html, ["--reviews"]))


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


def _one_object(stdout: str) -> dict:
    line = stdout.strip()
    if not line:
        raise ExtractorError("the extractor wrote nothing")
    try:
        return json.loads(line)
    except json.JSONDecodeError as error:
        raise ExtractorError(f"the extractor wrote something that is not json: {error}") from error


# a malformed or partial line is an error, never a zero: check.py reads a
# review count of zero as "the page changed and extraction broke", which is
# a claim about amazon, and a broken extractor must not be able to make it.
def parse_extractor_output(stdout: str) -> ExtractionOutcome:
    data = _one_object(stdout)
    try:
        return ExtractionOutcome(
            review_count=int(data["reviewCount"]), rules_version=int(data["rulesVersion"])
        )
    except (KeyError, TypeError, ValueError) as error:
        raise ExtractorError(f"the extractor's output is missing a field: {error}") from error


def parse_full_extractor_output(stdout: str) -> FullExtraction:
    data = _one_object(stdout)
    try:
        product = data["product"]
        return FullExtraction(
            url=str(data["url"]),
            site=data["site"],
            locale=data["locale"],
            rules_version=int(data["rulesVersion"]),
            review_count=int(data["reviewCount"]),
            title=data["title"],
            product=None if product is None else product_snapshot_from_json(product),
            reviews=[review_from_json(review) for review in data["reviews"]],
        )
    except (KeyError, TypeError, ValueError) as error:
        raise ExtractorError(f"the extractor's output is missing a field: {error}") from error
