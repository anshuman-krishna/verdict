import json

from verdict_research.canary.check import CanarySummary
from verdict_research.canary.status_document import (
    build_status_document,
    empty_status_document,
    read_status_document,
    write_status_document_file,
)

SUMMARY = CanarySummary(
    site="amazon",
    locale="com",
    last_verified=1_700_000_000.0,
    status="healthy",
    rules_version=41,
    median_reviews_extracted=120.0,
)


class TestBuildStatusDocument:
    # SITE.md's /status columns, in the shape the astro page reads.
    def test_carries_one_row_per_summary_with_the_status_pages_columns(self):
        document = build_status_document([SUMMARY], generated_at=1_700_000_100.0)
        assert document == {
            "documentVersion": 1,
            "generatedAt": 1_700_000_100.0,
            "rows": [
                {
                    "site": "amazon",
                    "locale": "com",
                    "lastVerified": 1_700_000_000.0,
                    "status": "healthy",
                    "rulesVersion": 41,
                    "medianReviewsExtracted": 120.0,
                }
            ],
        }

    # a target whose every run failed has no review count to take a median
    # of, and the page has to render that rather than showing a zero.
    def test_carries_a_null_median_and_rules_version_through(self):
        failed = CanarySummary(
            site="amazon",
            locale="de",
            last_verified=1.0,
            status="failed",
            rules_version=None,
            median_reviews_extracted=None,
        )
        row = build_status_document([failed], generated_at=2.0)["rows"][0]
        assert row["rulesVersion"] is None
        assert row["medianReviewsExtracted"] is None

    # the state the site ships in before the canary has ever run, which is
    # a normal document rather than a missing file.
    def test_the_empty_document_has_no_rows_and_still_parses(self):
        assert empty_status_document() == {
            "documentVersion": 1,
            "generatedAt": 0.0,
            "rows": [],
        }


class TestWriteStatusDocumentFile:
    def test_round_trips_through_a_file(self, tmp_path):
        path = tmp_path / "status.json"
        document = build_status_document([SUMMARY], generated_at=5.0)
        write_status_document_file(document, path)
        assert read_status_document(path) == document

    # committed into the site, so a run that changed nothing has to produce
    # no diff at all.
    def test_writes_byte_identical_output_for_the_same_document(self, tmp_path):
        first = tmp_path / "a.json"
        second = tmp_path / "b.json"
        document = build_status_document([SUMMARY], generated_at=5.0)
        write_status_document_file(document, first)
        write_status_document_file(build_status_document([SUMMARY], generated_at=5.0), second)
        assert first.read_bytes() == second.read_bytes()

    def test_ends_with_a_newline(self, tmp_path):
        path = tmp_path / "status.json"
        write_status_document_file(empty_status_document(), path)
        assert path.read_text(encoding="utf-8").endswith("}\n")
        assert json.loads(path.read_text(encoding="utf-8"))["rows"] == []
