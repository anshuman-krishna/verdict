import json

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


# a floor of zero would make every page healthy forever, which is the one
# value that turns the canary off without looking like it is off.
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


def test_the_example_file_parses():
    # it ships with placeholder ids, but its shape has to stay valid or it
    # is documentation for a format nothing accepts
    from pathlib import Path

    example = Path(__file__).resolve().parents[1] / "canary-targets.example.json"
    assert len(read_targets(example)) >= 1
