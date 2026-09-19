import base64
import json

import pytest

from verdict_research.features.embedding_backend import (
    BUNDLED_ARTIFACT,
    HASHED_TERMS_IDENTITY,
    LEXICON_ARTIFACT_VERSION,
    backend_from_artifact,
    bundled_embedding_backend,
    from_lexicon,
    hashed_terms,
)
from verdict_research.features.lexicon import build_lexicon, parse_lexicon
from verdict_research.features.text_embedding import (
    EMBEDDING_DIMENSIONS,
    cosine_similarity,
    embed_text,
)

VECTORS = {
    "kettle": [1.0, 0.0, 0.0, 0.0],
    "stove": [0.0, 1.0, 0.0, 0.0],
    "filter": [0.0, 0.0, 1.0, 0.0],
}


def table():
    return parse_lexicon(build_lexicon(VECTORS))


def artifact(**overrides):
    base = {
        "artifactVersion": LEXICON_ARTIFACT_VERSION,
        "present": True,
        "identity": "kettles-3d",
        "bytes": base64.b64encode(build_lexicon(VECTORS)).decode("ascii"),
    }
    base.update(overrides)
    return base


def test_hashed_terms_is_the_embedding_the_scorer_has_always_used():
    assert hashed_terms().embed("a good kettle") == embed_text("a good kettle")
    assert hashed_terms().identity == f"{HASHED_TERMS_IDENTITY}/{EMBEDDING_DIMENSIONS}"
    assert hashed_terms(64).dimensions == 64


def test_a_lexicon_backend_averages_the_words_it_knows():
    embedded = from_lexicon(table(), "kettles-3d").embed("kettle stove")

    assert embedded[0] == pytest.approx(2**-0.5)
    assert embedded[1] == pytest.approx(2**-0.5)
    assert embedded[2] == 0.0


def test_a_word_said_twice_weighs_twice():
    embedded = from_lexicon(table(), "kettles-3d").embed("kettle kettle stove")

    assert embedded[0] == pytest.approx(2 / 5**0.5)
    assert embedded[1] == pytest.approx(1 / 5**0.5)


def test_words_it_does_not_hold_move_nothing():
    backend = from_lexicon(table(), "kettles-3d")

    assert backend.embed("sprocket kettle flange") == backend.embed("kettle")
    assert backend.embed("sprocket flange") is None


def test_unrelated_words_sit_further_apart_than_repeated_ones():
    backend = from_lexicon(table(), "kettles-3d")

    kettle = backend.embed("kettle")
    assert cosine_similarity(kettle, backend.embed("stove")) == pytest.approx(0.0, abs=1e-6)
    assert cosine_similarity(kettle, backend.embed("a kettle, and a kettle")) == pytest.approx(
        1.0, abs=1e-6
    )


def test_a_bundled_table_is_read_and_named():
    backend = backend_from_artifact(artifact())

    assert backend.identity == "kettles-3d"
    assert backend.dimensions == 4


@pytest.mark.parametrize(
    "broken",
    [
        {"artifactVersion": 1, "present": False, "reason": "none built"},
        "a lexicon",
        None,
        [],
    ],
)
def test_a_build_with_no_table_still_embeds(broken):
    assert backend_from_artifact(broken).identity == hashed_terms().identity


@pytest.mark.parametrize(
    "overrides",
    [
        {"bytes": base64.b64encode(b"not a table").decode("ascii")},
        {"bytes": "not base64 at all !!"},
        {"bytes": 41},
        {"identity": ""},
        {"artifactVersion": 99},
        {"present": "yes"},
    ],
)
def test_a_table_that_cannot_be_read_is_not_shipped_as_one(overrides):
    assert backend_from_artifact(artifact(**overrides)).identity == hashed_terms().identity


def test_it_takes_the_fallback_it_is_handed():
    assert backend_from_artifact(None, hashed_terms(64)).dimensions == 64


def test_the_bundled_table_is_read_from_the_file_the_extension_ships(tmp_path):
    path = tmp_path / "lexicon.json"
    path.write_text(json.dumps(artifact()), encoding="utf-8")

    assert bundled_embedding_backend(path).identity == "kettles-3d"


def test_a_build_whose_artifact_is_missing_or_broken_still_embeds(tmp_path):
    missing = tmp_path / "gone.json"
    broken = tmp_path / "broken.json"
    broken.write_text("{ not json", encoding="utf-8")

    assert bundled_embedding_backend(missing).identity == hashed_terms().identity
    assert bundled_embedding_backend(broken).identity == hashed_terms().identity


def test_this_repository_bundles_something_python_can_read():
    assert BUNDLED_ARTIFACT.exists()
    assert bundled_embedding_backend().dimensions > 0
