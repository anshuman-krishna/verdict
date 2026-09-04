import pytest

from verdict_research.features.verification_concentration import (
    ReviewForVerification,
    verification_concentration,
)


def review(rating, verified, inside_burst):
    return ReviewForVerification(rating=rating, verified=verified, inside_burst=inside_burst)


def test_computes_a_lift_of_two_when_the_burst_stratum_is_twice_as_unverified():
    reviews = [
        review(5, False, True),
        review(5, False, True),
        review(5, False, True),
        review(5, False, True),
        review(5, True, True),
        review(3, True, False),
        review(3, True, False),
        review(3, True, False),
        review(3, True, False),
        review(3, True, False),
    ]
    result = verification_concentration(reviews)
    assert result.base_count == 5
    assert result.lift == pytest.approx(2, abs=1e-10)


def test_excludes_reviews_with_unknown_verification_status():
    reviews = [
        review(5, False, True),
        review(5, False, True),
        review(5, False, True),
        review(5, False, True),
        review(5, True, True),
        review(3, True, False),
        review(3, True, False),
        review(3, True, False),
        review(3, True, False),
        review(3, True, False),
        review(5, None, True),
        review(3, None, False),
    ]
    result = verification_concentration(reviews)
    assert result.base_count == 5
    assert result.lift == pytest.approx(2, abs=1e-10)


def test_returns_none_when_nothing_falls_in_the_stratum():
    reviews = [
        review(5, False, False),
        review(3, True, True),
        review(4, False, True),
    ]
    result = verification_concentration(reviews)
    assert result.base_count == 0
    assert result.lift is None


def test_returns_none_when_there_is_no_unverified_baseline():
    reviews = [
        review(5, True, True),
        review(3, True, False),
    ]
    result = verification_concentration(reviews)
    assert result.lift is None


def test_returns_none_and_zero_base_count_for_an_empty_review_set():
    result = verification_concentration([])
    assert result.lift is None
    assert result.base_count == 0
