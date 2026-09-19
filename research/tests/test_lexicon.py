import struct

import pytest

from verdict_research.features.lexicon import (
    LEXICON_HEADER_BYTES,
    LEXICON_MAGIC,
    LEXICON_VERSION,
    LexiconError,
    build_lexicon,
    parse_lexicon,
)

VECTORS = {"kettle": [1.0, 0.0, 0.0, 0.0], "stove": [0.0, -1.0, 0.0, 0.0]}


def test_a_table_reads_back_the_way_it_was_written():
    table = parse_lexicon(build_lexicon(VECTORS))

    assert table is not None
    assert table.version == LEXICON_VERSION
    assert table.dimensions == 4
    assert table.token_count == 2
    assert table.tokens == ["kettle", "stove"]


def test_a_row_comes_back_at_full_scale():
    table = parse_lexicon(build_lexicon(VECTORS))

    assert table.row("kettle")[0] == pytest.approx(1.0, abs=1e-6)
    assert table.row("stove")[1] == pytest.approx(-1.0, abs=1e-6)
    assert table.row("sprocket") is None


def test_a_row_is_stored_as_a_direction_not_a_length():
    long = build_lexicon({"kettle": [12.0, 0.0, 0.0, 0.0]})
    short = build_lexicon({"kettle": [0.25, 0.0, 0.0, 0.0]})

    assert parse_lexicon(long).row("kettle") == parse_lexicon(short).row("kettle")


def test_quantising_keeps_the_angle_between_two_words():
    table = parse_lexicon(build_lexicon({"kettle": [3.0, 4.0, 0.0, 0.0]}))

    row = table.row("kettle")
    assert row[0] == pytest.approx(0.6, abs=0.01)
    assert row[1] == pytest.approx(0.8, abs=0.01)


def test_the_header_says_what_the_format_says_it_says():
    raw = build_lexicon(VECTORS)

    magic, version, dimensions, count, scale, token_bytes = struct.unpack_from("<4sHHIfI", raw)
    assert magic == LEXICON_MAGIC
    assert version == LEXICON_VERSION
    assert (dimensions, count) == (4, 2)
    assert scale == pytest.approx(1 / 127, rel=1e-6)
    assert len(raw) == LEXICON_HEADER_BYTES + token_bytes + count * dimensions


def test_bytes_that_are_not_a_table_are_not_read_as_one():
    assert parse_lexicon(b"") is None
    assert parse_lexicon(b"NOPE" + bytes(40)) is None


def test_a_truncated_table_is_refused_rather_than_read_short():
    raw = build_lexicon(VECTORS)

    assert parse_lexicon(raw[:-1]) is None


def test_a_version_this_build_cannot_read_is_refused():
    raw = bytearray(build_lexicon(VECTORS))
    struct.pack_into("<H", raw, 4, 99)

    assert parse_lexicon(bytes(raw)) is None


def test_a_table_naming_the_same_token_twice_is_refused():
    raw = bytearray(build_lexicon({"kettle": [1.0, 0.0], "stoves": [0.0, 1.0]}))
    raw[LEXICON_HEADER_BYTES : LEXICON_HEADER_BYTES + 13] = b"kettle\nkettle"

    assert parse_lexicon(bytes(raw)) is None


def test_building_refuses_what_cannot_be_looked_up_or_stored():
    with pytest.raises(LexiconError):
        build_lexicon({})
    with pytest.raises(LexiconError):
        build_lexicon({"kettle\nstove": [1.0, 0.0]})
    with pytest.raises(LexiconError):
        build_lexicon({"kettle": [1.0, 0.0], "stove": [1.0]})
    with pytest.raises(LexiconError):
        build_lexicon({"kettle": []})
    with pytest.raises(LexiconError):
        build_lexicon(VECTORS, scale=0.0)


def test_a_word_with_no_direction_stores_as_no_direction():
    table = parse_lexicon(build_lexicon({"kettle": [0.0, 0.0]}))

    assert table.row("kettle") == [0.0, 0.0]
