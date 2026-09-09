import json
import subprocess

import pytest

from verdict_research.shipped_extractor import (
    ExtractorError,
    NodeExtractor,
    NodeReviewExtractor,
    parse_extractor_output,
    parse_full_extractor_output,
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


FULL = json.dumps(
    {
        "url": "https://www.amazon.com/dp/B0ABCDEF12",
        "site": "amazon",
        "locale": "com",
        "rulesVersion": 41,
        "reviewCount": 1,
        "title": "a knife set",
        "product": {
            "title": "a knife set",
            "category": "kitchen",
            "claimedRating": 4.6,
            "reviewCount": 90,
            "site": "amazon",
            "locale": "com",
            "url": "https://www.amazon.com/dp/B0ABCDEF12",
            "thumbnailUrl": None,
        },
        "reviews": [
            {
                "rating": 5,
                "text": "cut cleanly",
                "date": "2024-01-02",
                "verified": True,
                "reviewerId": "abc",
            }
        ],
    }
)


class TestParseFullExtractorOutput:
    def test_reads_the_reviews_and_the_product(self):
        result = parse_full_extractor_output(FULL)
        assert result.reviews[0].rating == 5
        assert result.product is not None
        assert result.product.category == "kitchen"
        assert result.locale == "com"

    def test_a_page_with_no_product_is_not_an_error(self):
        data = json.loads(FULL)
        data["product"] = None
        data["reviews"] = []
        result = parse_full_extractor_output(json.dumps(data))
        assert result.product is None
        assert result.reviews == []

    def test_a_missing_field_is_an_error(self):
        data = json.loads(FULL)
        del data["reviews"]
        with pytest.raises(ExtractorError, match="missing a field"):
            parse_full_extractor_output(json.dumps(data))

    def test_empty_output_is_an_error(self):
        with pytest.raises(ExtractorError, match="wrote nothing"):
            parse_full_extractor_output("  \n")


class TestNodeReviewExtractor:
    def test_asks_the_shipped_extractor_for_the_reviews(self, tmp_path):
        artefact = tmp_path / "extract.mjs"
        artefact.write_text("", encoding="utf-8")
        seen: list[list[str]] = []

        def run(argv, html, timeout):
            seen.append(list(argv))
            return completed(stdout=FULL)

        extractor = NodeReviewExtractor(extractor_path=artefact, run=run)
        result = extractor("<html></html>", "https://www.amazon.com/dp/B0ABCDEF12")
        assert len(result.reviews) == 1
        assert "--reviews" in seen[0]

    def test_refuses_to_run_without_the_built_artefact(self, tmp_path):
        extractor = NodeReviewExtractor(extractor_path=tmp_path / "absent.mjs")
        with pytest.raises(ExtractorError, match="just canary-extractor"):
            extractor("<html></html>", "https://www.amazon.com/dp/B0ABCDEF12")
