import pytest

from verdict_research.dispute.document import (
    DOCUMENT_VERSION,
    DocumentError,
    parse_report_document,
    unreproducible_reason,
)


def document(**overrides):
    base = {
        "documentVersion": DOCUMENT_VERSION,
        "exportedAt": 1_700_000_000_000,
        "title": "a stovetop kettle",
        "report": {
            "serial": "7F2A-0091",
            "band": "mixed",
            "probability": 0.42,
            "claimedRating": 4.6,
            "adjustedRating": 3.9,
            "totalReviewCount": 8431,
            "excludedReviewCount": 1208,
            "confidence": {"low": 0.3, "high": 0.5},
            "evidence": [{"signal": "rating shape", "strength": "moderate"}],
            "unavailableSignals": ["reviewer network"],
            "absentSignals": [],
            "generatedAt": 1_699_000_000_000,
            "provenance": {"extensionVersion": "0.1.0", "rulesSite": "amazon"},
        },
        "features": {
            "ratingDeconvolution.injectedShare": 0.15,
            "verificationConcentration.lift": None,
        },
    }
    base.update(overrides)
    return base


def test_reads_the_document_the_extension_writes():
    read = parse_report_document(document())

    assert read.serial == "7F2A-0091"
    assert read.band == "mixed"
    assert read.probability == pytest.approx(0.42)
    assert read.features["ratingDeconvolution.injectedShare"] == pytest.approx(0.15)
    assert read.features["verificationConcentration.lift"] is None
    assert read.unavailable_signals == ["reviewer network"]
    assert read.reproducible


def test_refuses_something_that_is_not_a_document():
    for value in [None, 7, "a report", []]:
        with pytest.raises(DocumentError):
            parse_report_document(value)


def test_refuses_a_document_with_no_version():
    with pytest.raises(DocumentError, match="names no version"):
        parse_report_document(document(documentVersion=None))


def test_refuses_a_version_written_by_a_newer_build():
    with pytest.raises(DocumentError, match="newer build"):
        parse_report_document(document(documentVersion=DOCUMENT_VERSION + 1))


def test_refuses_a_document_carrying_no_report():
    with pytest.raises(DocumentError, match="carries no report"):
        parse_report_document(document(report="a kettle"))


def test_an_older_document_reads_and_says_why_it_cannot_be_rerun():
    older = document(documentVersion=1)
    del older["features"]

    read = parse_report_document(older)

    assert read.band == "mixed"
    assert not read.reproducible
    assert "cannot be run again" in (unreproducible_reason(read) or "")


def test_a_document_with_no_features_says_so_rather_than_scoring_nothing():
    read = parse_report_document(document(features={}))

    assert "carries no features" in (unreproducible_reason(read) or "")


def test_a_report_with_no_probability_has_nothing_to_compare_against():
    without = document()
    del without["report"]["probability"]

    read = parse_report_document(without)

    assert "no probability" in (unreproducible_reason(read) or "")


def test_a_reproducible_document_has_no_reason_not_to_be():
    assert unreproducible_reason(parse_report_document(document())) is None


def test_reads_a_document_whose_fields_are_the_wrong_shape_without_crashing():
    read = parse_report_document(
        {
            "documentVersion": DOCUMENT_VERSION,
            "title": 7,
            "report": {"band": 4, "serial": None, "unavailableSignals": "reviewer network"},
        }
    )

    assert read.title == ""
    assert read.serial == ""
    assert read.band is None
    assert read.unavailable_signals == []
    assert read.features == {}
