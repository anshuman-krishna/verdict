import json
from pathlib import Path

import pytest

from verdict_research.canary.targets import TargetsError, parse_targets, read_targets

VALID = """
[
  {"site": "amazon", "locale": "com", "url": "https://www.amazon.com/dp/B0ABCDEF12",
   "minimumExpectedReviews": 20}
]
"""


def test_reads_a_valid_target():
    targets = parse_targets(VALID)
    assert len(targets) == 1
    assert targets[0].locale == "com"
    assert targets[0].minimum_expected_reviews == 20


def test_reads_an_empty_list():
    assert parse_targets("[]") == []


def test_refuses_something_that_is_not_a_list():
    with pytest.raises(TargetsError, match="array"):
        parse_targets('{"site": "amazon"}')


def test_refuses_invalid_json():
    with pytest.raises(TargetsError, match="json"):
        parse_targets("[")


@pytest.mark.parametrize("key", ["site", "locale", "url"])
def test_refuses_a_target_missing_a_required_string(key):
    entry = {
        "site": "amazon",
        "locale": "com",
        "url": "https://www.amazon.com/dp/B0ABCDEF12",
        "minimumExpectedReviews": 20,
    }
    del entry[key]
    with pytest.raises(TargetsError, match=key):
        parse_targets(json.dumps([entry]))


def test_refuses_a_plain_http_url():
    with pytest.raises(TargetsError, match="https"):
        parse_targets(VALID.replace("https://", "http://"))


def test_refuses_a_floor_below_one():
    with pytest.raises(TargetsError, match="positive integer"):
        parse_targets(VALID.replace("20", "0"))


def test_refuses_a_non_integer_floor():
    with pytest.raises(TargetsError, match="positive integer"):
        parse_targets(VALID.replace("20", "20.5"))


def test_refuses_a_boolean_floor():
    with pytest.raises(TargetsError, match="positive integer"):
        parse_targets(VALID.replace("20", "true"))


def test_names_the_target_index_in_the_error():
    raw = VALID.strip()[:-1] + ', {"site": "amazon"}]'
    with pytest.raises(TargetsError, match="target 1"):
        parse_targets(raw)


def test_reading_a_missing_file_is_an_error_not_an_empty_list(tmp_path):
    with pytest.raises(TargetsError):
        read_targets(tmp_path / "absent.json")


EXAMPLE = Path(__file__).resolve().parents[1] / "canary-targets.example.json"


def test_the_example_file_parses_once_its_placeholders_are_filled_in():
    filled = EXAMPLE.read_text(encoding="utf-8").replace("REPLACEMEXX", "B0ABCDEF12")
    assert len(parse_targets(filled)) >= 1


def test_the_unedited_example_is_refused_rather_than_fetched():
    with pytest.raises(TargetsError, match="REPLACEMEXX.*not a product page"):
        read_targets(EXAMPLE)


@pytest.mark.parametrize(
    "url",
    [
        "https://www.amazon.com/s?k=kettle",
        "https://www.amazon.com/dp/B0ABC",
        "https://example.com/dp/B0ABCDEF12",
    ],
)
def test_refuses_a_url_that_is_not_a_product_page(url):
    with pytest.raises(TargetsError, match="not a product page"):
        parse_targets(VALID.replace("https://www.amazon.com/dp/B0ABCDEF12", url))


def test_refuses_a_url_from_another_locale_than_the_one_named():
    # the status page would show one marketplace's health under another's name
    with pytest.raises(TargetsError, match="amazon co.uk, not the amazon com"):
        parse_targets(VALID.replace("www.amazon.com", "www.amazon.co.uk"))


def test_accepts_the_longer_product_path_and_a_lowercase_id():
    raw = VALID.replace("/dp/B0ABCDEF12", "/gp/product/b0abcdef12/ref=x")
    assert parse_targets(raw)[0].url.endswith("ref=x")
