import json
from pathlib import Path

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from verdict_research.schema import (
    product_snapshot_from_json,
    product_snapshot_to_json,
    review_from_json,
    review_to_json,
)

SCHEMA_DIR = Path(__file__).parent.parent.parent / "schema"

with open(SCHEMA_DIR / "verdict.schema.json") as f:
    SCHEMA = json.load(f)

with open(SCHEMA_DIR / "examples" / "review.json") as f:
    REVIEW_EXAMPLES = json.load(f)

with open(SCHEMA_DIR / "examples" / "product-snapshot.json") as f:
    PRODUCT_SNAPSHOT_EXAMPLE = json.load(f)


def validate(def_name: str, data: dict) -> None:
    definition = SCHEMA["$defs"][def_name]
    validator = Draft202012Validator(definition, format_checker=Draft202012Validator.FORMAT_CHECKER)
    validator.validate(data)


def is_valid(def_name: str, data: dict) -> bool:
    try:
        validate(def_name, data)
        return True
    except ValidationError:
        return False


def test_review_examples_are_valid():
    for example in REVIEW_EXAMPLES:
        assert is_valid("review", example)


def test_review_round_trips_through_the_dataclass():
    original = REVIEW_EXAMPLES[0]
    review = review_from_json(original)
    round_tripped = review_to_json(review)
    assert round_tripped == original
    assert is_valid("review", round_tripped)


def test_review_missing_a_required_field_is_rejected():
    without_rating = {k: v for k, v in REVIEW_EXAMPLES[0].items() if k != "rating"}
    assert not is_valid("review", without_rating)


def test_review_out_of_range_rating_is_rejected():
    invalid = {**REVIEW_EXAMPLES[0], "rating": 6}
    assert not is_valid("review", invalid)


def test_product_snapshot_example_is_valid():
    assert is_valid("productSnapshot", PRODUCT_SNAPSHOT_EXAMPLE)


def test_product_snapshot_round_trips_through_the_dataclass():
    snapshot = product_snapshot_from_json(PRODUCT_SNAPSHOT_EXAMPLE)
    round_tripped = product_snapshot_to_json(snapshot)
    assert round_tripped == PRODUCT_SNAPSHOT_EXAMPLE
    assert is_valid("productSnapshot", round_tripped)


def test_product_snapshot_null_title_is_rejected():
    invalid = {**PRODUCT_SNAPSHOT_EXAMPLE, "title": None}
    assert not is_valid("productSnapshot", invalid)
