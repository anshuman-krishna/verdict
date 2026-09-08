from verdict_research.features.text_embedding import (
    EMBEDDING_DIMENSIONS,
    cosine_similarity,
    embed_term_counts,
    embed_text,
    hash_terms,
    terms,
    tokenize,
)


def test_tokenize_splits_on_everything_that_is_not_a_letter_or_number():
    assert tokenize("Great phone-case, 10/10!") == ["great", "phone", "case", "10", "10"]


def test_tokenize_keeps_accented_and_non_latin_words_whole():
    assert tokenize("Trés bien, qualité 品質") == ["trés", "bien", "qualité", "品質"]


def test_tokenize_returns_nothing_without_alphanumerics():
    assert tokenize("!!! ... ???") == []


def test_terms_adds_adjacent_bigrams_after_the_unigrams():
    assert terms(["phone", "case", "black"]) == [
        "phone",
        "case",
        "black",
        "phone case",
        "case black",
    ]


def test_hash_terms_is_ascending_pairs_of_bucket_and_count():
    flat = hash_terms("a solid usb cable")
    buckets = flat[0::2]
    assert buckets == sorted(buckets)
    assert len(set(buckets)) == len(buckets)
    assert all(0 <= bucket < EMBEDDING_DIMENSIONS for bucket in buckets)


def test_embed_text_is_a_unit_vector_of_the_requested_width():
    vector = embed_text("a solid usb cable")
    assert vector is not None
    assert len(vector) == EMBEDDING_DIMENSIONS
    assert abs(cosine_similarity(vector, vector) - 1) < 1e-12


def test_embed_text_is_none_when_there_is_nothing_to_embed():
    assert embed_text("   ") is None


def test_embed_text_ignores_punctuation_and_case():
    assert embed_text("Fast charging cable!") == embed_text("fast, charging cable")


def test_embed_text_scores_related_text_above_unrelated_text():
    product = embed_text("stainless steel kitchen knife set")
    on_topic = embed_text("the kitchen knife set is sharp stainless steel")
    off_topic = embed_text("battery lasted two days on my phone")
    assert cosine_similarity(on_topic, product) > cosine_similarity(off_topic, product)


def test_embed_text_separates_word_order():
    assert cosine_similarity(embed_text("case phone"), embed_text("phone case")) < 1


def test_embed_term_counts_rejects_a_bucket_outside_the_width():
    assert embed_term_counts([EMBEDDING_DIMENSIONS, 1]) is None


def test_embed_term_counts_round_trips_hash_terms():
    text = "the kitchen knife set holds an edge"
    assert embed_term_counts(hash_terms(text)) == embed_text(text)
