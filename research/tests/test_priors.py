import json

import pytest

from verdict_research.features import priors as priors_module
from verdict_research.features.priors import (
    DEFAULT_INJECTION_KERNEL,
    DEFAULT_ORGANIC_PRIOR,
    category_keys,
    category_slug,
    default_priors,
    known_priors_digests,
    priors_category_keys,
    priors_digest,
    priors_document_digest,
    priors_for,
)

SCHEMA = priors_module._PRIORS_PATH


def test_both_are_five_bin_histograms_that_sum_to_one():
    assert len(DEFAULT_ORGANIC_PRIOR) == 5
    assert len(DEFAULT_INJECTION_KERNEL) == 5
    assert abs(sum(DEFAULT_ORGANIC_PRIOR) - 1) < 1e-9
    assert abs(sum(DEFAULT_INJECTION_KERNEL) - 1) < 1e-9


def test_concentrates_the_injection_kernel_on_four_and_five_stars():
    assert DEFAULT_INJECTION_KERNEL[:3] == [0.0, 0.0, 0.0]
    assert DEFAULT_INJECTION_KERNEL[4] > DEFAULT_INJECTION_KERNEL[3]


def test_carries_the_product_text_the_drift_signal_needs():
    assert default_priors("a knife set kitchen").product_text == "a knife set kitchen"


def test_the_digest_changes_when_the_priors_do():
    base = default_priors()
    changed = default_priors()
    changed.injection_kernel = [0, 0, 0.1, 0.3, 0.6]
    assert priors_digest(base) != priors_digest(changed)


def test_the_digest_is_stable_across_calls():
    assert priors_digest(default_priors()) == priors_digest(default_priors("anything"))


def test_the_document_digest_ignores_the_note_and_reads_the_numbers():
    with open(SCHEMA, encoding="utf-8") as handle:
        document = json.load(handle)
    assert document["note"]
    assert priors_document_digest() == priors_document_digest()
    assert len(priors_document_digest()) == 8


@pytest.mark.parametrize(
    ("segment", "slug"),
    [
        ("Home & Kitchen", "home-kitchen"),
        ("  Coffee, Tea  &  Espresso ", "coffee-tea-espresso"),
        ("Bücher", "bücher"),
        ("ホーム＆キッチン", "ホーム-キッチン"),
        ("  ...  ", ""),
    ],
)
def test_one_segment_reduces_to_a_key(segment, slug):
    assert category_slug(segment) == slug


def test_a_trail_reads_narrowest_first():
    assert category_keys("Home & Kitchen > Coffee > Espresso Machines") == [
        "espresso-machines",
        "coffee",
        "home-kitchen",
    ]
    assert category_keys("Books >  > Books > Fiction") == ["fiction", "books"]
    assert category_keys(None) == []


def test_every_shipped_entry_is_a_histogram_that_sums_to_one():
    for key in priors_category_keys():
        resolved = priors_for(key)
        assert resolved.key == key
        assert len(resolved.inputs.organic_prior) == 5
        assert abs(sum(resolved.inputs.organic_prior) - 1) < 1e-9


# week 4 has not run, so nothing is estimated yet and every listing takes the one shape
def test_falls_back_to_the_default_until_a_corpus_fills_it():
    resolved = priors_for("Home & Kitchen > Kettles")
    assert resolved.key is None
    assert resolved.inputs.organic_prior == DEFAULT_ORGANIC_PRIOR


def test_the_known_digests_cover_the_default_and_every_entry():
    known = known_priors_digests()
    assert priors_digest(default_priors()) in known
    for key in priors_category_keys():
        assert priors_digest(priors_for(key).inputs) in known


def test_a_prior_this_document_never_held_is_not_known():
    stale = default_priors()
    stale.organic_prior = [0.1, 0.1, 0.1, 0.1, 0.6]
    assert priors_digest(stale) not in known_priors_digests()
