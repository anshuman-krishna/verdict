from verdict_research.features.text_near_duplication import (
    ReviewForNearDuplication,
    estimate_jaccard,
    exact_jaccard,
    fnv1a64,
    minhash_signature,
    shingle,
    text_near_duplication,
)


def review(text):
    return ReviewForNearDuplication(text=text)


def test_fnv1a64_is_deterministic_and_sensitive_to_input():
    assert fnv1a64("a review of a good product") == fnv1a64("a review of a good product")
    assert fnv1a64("abc") != fnv1a64("abd")


def test_shingle_produces_every_overlapping_5_character_window():
    assert shingle("hello", 5) == {"hello"}
    assert shingle("helloo", 5) == {"hello", "elloo"}


def test_shingle_lowercases_and_collapses_whitespace():
    assert shingle("HELLO", 5) == {"hello"}
    assert shingle("a    b", 5) == shingle("a b", 5)


def test_shingle_treats_short_text_as_a_single_shingle():
    assert shingle("hi", 5) == {"hi"}


def test_exact_jaccard_hand_computed_two_of_four_union_members():
    # {a,b,c} union {b,c,d} = {a,b,c,d}, intersection = {b,c}, 2/4 = 0.5
    assert exact_jaccard({"a", "b", "c"}, {"b", "c", "d"}) == 0.5


def test_exact_jaccard_edge_cases():
    assert exact_jaccard(set(), set()) == 1.0
    assert exact_jaccard({"a"}, {"b"}) == 0.0


def test_minhash_signature_is_identical_for_identical_shingle_sets():
    shingles = shingle("this product works exactly as described", 5)
    assert minhash_signature(shingles, 16) == minhash_signature(shingles, 16)


def test_estimated_jaccard_is_one_for_identical_signatures():
    signature = minhash_signature(shingle("identical text here", 5), 32)
    assert estimate_jaccard(signature, signature) == 1.0


def test_estimated_jaccard_is_zero_for_disjoint_shingle_sets():
    digits = minhash_signature(shingle("00000 11111 22222 33333", 5), 32)
    letters = minhash_signature(shingle("aaaaa bbbbb ccccc ddddd", 5), 32)
    assert estimate_jaccard(digits, letters) == 0.0


def test_clusters_exact_duplicate_reviews_and_leaves_unique_ones_out():
    reviews = [
        review("works great, exactly as advertised, would buy again"),
        review("works great, exactly as advertised, would buy again"),
        review("works great, exactly as advertised, would buy again"),
        review("this is a completely different review about a totally different item"),
        review("nothing at all like the others, unique wording throughout this one"),
    ]
    result = text_near_duplication(reviews)
    assert result.cluster_count == 1
    assert result.duplicate_review_share == 3 / 5
    assert result.largest_cluster_share == 3 / 5


def test_finds_no_clusters_when_every_review_is_unique():
    reviews = [
        review("the packaging was excellent and arrived a day early"),
        review("battery life is shorter than the listing claims outright"),
        review("customer support resolved my question within an hour today"),
    ]
    result = text_near_duplication(reviews)
    assert result.cluster_count == 0
    assert result.duplicate_review_share == 0.0
    assert result.largest_cluster_share == 0.0


def test_excludes_reviews_with_none_or_empty_text_from_the_denominator():
    reviews = [
        review("a genuine review with real detail about the product"),
        review(None),
        review(""),
        review("a second, entirely different genuine review here"),
    ]
    result = text_near_duplication(reviews)
    assert result.cluster_count == 0
    assert result.duplicate_review_share == 0.0


def test_returns_none_for_fewer_than_2_eligible_reviews():
    empty = text_near_duplication([])
    assert empty.duplicate_review_share is None
    assert empty.cluster_count == 0
    assert empty.largest_cluster_share == 0.0

    single = text_near_duplication([review("only one review here")])
    assert single.duplicate_review_share == 0.0
    assert single.cluster_count == 0


def test_forms_two_separate_clusters_for_two_distinct_groups_of_duplicates():
    reviews = [
        review("group one duplicate text appears here word for word"),
        review("group one duplicate text appears here word for word"),
        review("group two duplicate text is completely different from group one"),
        review("group two duplicate text is completely different from group one"),
        review("a lone unique review that matches nothing else at all"),
    ]
    result = text_near_duplication(reviews)
    assert result.cluster_count == 2
    assert result.duplicate_review_share == 4 / 5
    assert result.largest_cluster_share == 2 / 5
