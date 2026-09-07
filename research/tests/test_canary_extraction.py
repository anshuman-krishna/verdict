import subprocess

import pytest

from verdict_research.canary.extraction import (
    ExtractorError,
    NodeExtractor,
    parse_extractor_output,
)


def completed(returncode: int = 0, stdout: str = "", stderr: str = ""):
    return subprocess.CompletedProcess(
        args=["node"], returncode=returncode, stdout=stdout, stderr=stderr
    )


class TestParseExtractorOutput:
    def test_reads_a_complete_line(self):
        outcome = parse_extractor_output('{"reviewCount": 42, "rulesVersion": 41}\n')
        assert outcome.review_count == 42
        assert outcome.rules_version == 41

    # check.py reads a review count of zero as "extraction broke on a live
    # page", which is a claim about amazon. A broken extractor must not be
    # able to make it.
    def test_empty_output_is_an_error_not_zero_reviews(self):
        with pytest.raises(ExtractorError, match="wrote nothing"):
            parse_extractor_output("   \n")

    def test_non_json_output_is_an_error_not_zero_reviews(self):
        with pytest.raises(ExtractorError, match="not json"):
            parse_extractor_output("Error: cannot find module\n")

    def test_a_missing_field_is_an_error_not_zero_reviews(self):
        with pytest.raises(ExtractorError, match="missing a field"):
            parse_extractor_output('{"reviewCount": 42}')

    def test_a_non_numeric_count_is_an_error(self):
        with pytest.raises(ExtractorError, match="missing a field"):
            parse_extractor_output('{"reviewCount": "many", "rulesVersion": 41}')


class TestNodeExtractor:
    def test_refuses_to_run_when_the_bundle_has_not_been_built(self, tmp_path):
        extractor = NodeExtractor(extractor_path=tmp_path / "absent.mjs")
        with pytest.raises(ExtractorError, match="just canary-extractor"):
            extractor("<html></html>", "https://www.amazon.com/dp/B0ABCDEF12")

    def test_passes_the_url_and_the_html_to_the_bundle(self, tmp_path):
        built = tmp_path / "extract.mjs"
        built.write_text("", encoding="utf-8")
        seen: dict[str, object] = {}

        def run(argv, html, timeout):
            seen["argv"] = list(argv)
            seen["html"] = html
            return completed(stdout='{"reviewCount": 3, "rulesVersion": 41}')

        outcome = NodeExtractor(extractor_path=built, run=run)(
            "<html>page</html>", "https://www.amazon.fr/dp/B0ABCDEF12"
        )
        assert outcome.review_count == 3
        assert seen["html"] == "<html>page</html>"
        assert seen["argv"][-1] == "https://www.amazon.fr/dp/B0ABCDEF12"

    def test_a_non_zero_exit_reports_the_bundles_own_error(self, tmp_path):
        built = tmp_path / "extract.mjs"
        built.write_text("", encoding="utf-8")
        extractor = NodeExtractor(
            extractor_path=built,
            run=lambda argv, html, timeout: completed(returncode=1, stderr="happy-dom is missing"),
        )
        with pytest.raises(ExtractorError, match="happy-dom is missing"):
            extractor("<html></html>", "https://www.amazon.com/dp/B0ABCDEF12")

    def test_a_silent_non_zero_exit_still_reports_something(self, tmp_path):
        built = tmp_path / "extract.mjs"
        built.write_text("", encoding="utf-8")
        extractor = NodeExtractor(
            extractor_path=built, run=lambda argv, html, timeout: completed(returncode=1)
        )
        with pytest.raises(ExtractorError, match="exited non zero"):
            extractor("<html></html>", "https://www.amazon.com/dp/B0ABCDEF12")
