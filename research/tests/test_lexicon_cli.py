import base64
import json

import pytest

from verdict_research.features.embedding_backend import backend_from_artifact, hashed_terms
from verdict_research.features.lexicon import parse_lexicon
from verdict_research.lexicon.cli import build, clear, show
from verdict_research.lexicon.source import SourceError, read_vectors

SOURCE = """kettle 1.0 0.0 0.0 0.0
stove 0.0 1.0 0.0 0.0
filter 0.0 0.0 1.0 0.0
"""


def source_file(tmp_path, text=SOURCE, name="kettles.txt"):
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


def test_reads_a_plain_vector_file():
    vectors, skipped = read_vectors(SOURCE.splitlines())

    assert list(vectors) == ["kettle", "stove", "filter"]
    assert vectors["stove"] == [0.0, 1.0, 0.0, 0.0]
    assert skipped == 0


def test_passes_over_the_word2vec_count_line():
    vectors, _ = read_vectors(["3 4", *SOURCE.splitlines()])

    assert list(vectors) == ["kettle", "stove", "filter"]


def test_passes_over_tokens_the_tokenizer_could_never_produce():
    vectors, skipped = read_vectors(["Kettle 1.0 0.0", "don't 1.0 0.0", "kettle 0.0 1.0"])

    assert list(vectors) == ["kettle"]
    assert skipped == 2


def test_keeps_the_first_of_a_repeated_token():
    vectors, skipped = read_vectors(["kettle 1.0 0.0", "kettle 0.0 1.0"])

    assert vectors == {"kettle": [1.0, 0.0]}
    assert skipped == 1


def test_says_which_line_it_could_not_read():
    with pytest.raises(SourceError, match="line 2"):
        read_vectors(["kettle 1.0 0.0", "stove 1.0 tepid"])

    with pytest.raises(SourceError, match="line 2"):
        read_vectors(["kettle 1.0 0.0", "stove 1.0"])


def test_refuses_a_file_with_nothing_that_can_be_looked_up():
    with pytest.raises(SourceError, match="tokenizer"):
        read_vectors(["Kettle 1.0 0.0"])


def test_reports_without_writing_unless_asked(tmp_path, capsys):
    output = tmp_path / "lexicon.json"

    assert build([str(source_file(tmp_path)), "--output", str(output)]) == 0

    printed = capsys.readouterr().out
    assert "tokens: 3 at 4 dimensions" in printed
    assert "pass --write" in printed
    assert not output.exists()


def test_writes_the_artifact_the_extension_bundles(tmp_path, capsys):
    output = tmp_path / "lexicon.json"

    assert build([str(source_file(tmp_path)), "--output", str(output), "--write"]) == 0

    written = json.loads(output.read_text(encoding="utf-8"))
    assert written["present"] is True
    assert written["identity"] == "kettles"
    table = parse_lexicon(base64.b64decode(written["bytes"]))
    assert table.token_count == 3
    assert backend_from_artifact(written).dimensions == 4
    assert f"wrote {output}" in capsys.readouterr().out


def test_takes_the_identity_a_report_should_name(tmp_path):
    output = tmp_path / "lexicon.json"

    build(
        [
            str(source_file(tmp_path)),
            "--identity",
            "glove-6b-4d",
            "--output",
            str(output),
            "--write",
        ]
    )

    assert json.loads(output.read_text(encoding="utf-8"))["identity"] == "glove-6b-4d"


def test_keeps_only_the_first_tokens_when_asked(tmp_path):
    output = tmp_path / "lexicon.json"

    build([str(source_file(tmp_path)), "--max-tokens", "2", "--output", str(output), "--write"])

    written = json.loads(output.read_text(encoding="utf-8"))
    assert parse_lexicon(base64.b64decode(written["bytes"])).tokens == ["kettle", "stove"]


def test_trims_the_table_until_the_artifact_fits_the_budget(tmp_path, capsys):
    output = tmp_path / "lexicon.json"
    full = tmp_path / "full.json"
    build([str(source_file(tmp_path)), "--output", str(full), "--write"])
    budget = len(full.read_text(encoding="utf-8").encode("utf-8")) - 8

    assert (
        build(
            [
                str(source_file(tmp_path)),
                "--max-bytes",
                str(budget),
                "--output",
                str(output),
                "--write",
            ]
        )
        == 0
    )

    written = json.loads(output.read_text(encoding="utf-8"))
    assert len(output.read_text(encoding="utf-8").encode("utf-8")) <= budget
    assert parse_lexicon(base64.b64decode(written["bytes"])).token_count < 3
    assert "tokens dropped" in capsys.readouterr().out


def test_refuses_a_budget_no_table_at_all_would_fit(tmp_path, capsys):
    assert build([str(source_file(tmp_path)), "--max-bytes", "10", "--write"]) == 1
    assert "not one token" in capsys.readouterr().err


def test_says_which_file_it_could_not_read(tmp_path, capsys):
    assert build([str(tmp_path / "nothing.txt")]) == 1
    assert "nothing.txt" in capsys.readouterr().err


def test_clearing_restores_the_absent_form_a_build_falls_back_from(tmp_path, capsys):
    output = tmp_path / "lexicon.json"
    build([str(source_file(tmp_path)), "--output", str(output), "--write"])

    assert clear(["--output", str(output), "--reason", "the licence is not settled"]) == 0

    written = json.loads(output.read_text(encoding="utf-8"))
    assert written["present"] is False
    assert written["reason"] == "the licence is not settled"
    assert backend_from_artifact(written).identity == hashed_terms().identity


def test_show_says_what_this_build_bundles(tmp_path, capsys):
    output = tmp_path / "lexicon.json"
    build([str(source_file(tmp_path)), "--output", str(output), "--write"])

    assert show(["--output", str(output)]) == 0
    assert "tokens: 3 at 4 dimensions" in capsys.readouterr().out

    clear(["--output", str(output)])
    assert show(["--output", str(output)]) == 0
    assert "no table bundled" in capsys.readouterr().out


def test_show_refuses_a_bundled_table_that_does_not_parse(tmp_path, capsys):
    output = tmp_path / "lexicon.json"
    output.write_text(
        json.dumps(
            {
                "artifactVersion": 1,
                "present": True,
                "identity": "broken",
                "bytes": base64.b64encode(b"not a table").decode("ascii"),
            }
        ),
        encoding="utf-8",
    )

    assert show(["--output", str(output)]) == 1
    assert "does not parse" in capsys.readouterr().err
