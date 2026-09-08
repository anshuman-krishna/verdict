import json
from pathlib import Path

from tests.test_featurise import extraction, reviews, snapshot, write_fixture
from verdict_research.corpus.cli import main
from verdict_research.corpus.dataset import load_jsonl
from verdict_research.corpus.featurise import example_id_for
from verdict_research.shipped_extractor import ExtractorError, FullExtraction


def labels(path: Path, rows: list[dict]) -> str:
    path.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
    return str(path)


def run(tmp_path, rows, extract=None):
    label_path = labels(tmp_path / "labels.jsonl", rows)
    output = tmp_path / "corpus.jsonl"
    code = main(
        [label_path, "--output", str(output), "--fixtures", str(tmp_path)],
        extract=extract or (lambda html, url: extraction(reviews(60), snapshot())),
    )
    return code, output


def test_writes_a_corpus_the_trainer_can_load(tmp_path, capsys):
    write_fixture(tmp_path, "one", "https://www.amazon.com/dp/B0ABCDEF12")
    write_fixture(tmp_path, "two", "https://www.amazon.fr/dp/B0ABCDEF13")
    code, output = run(tmp_path, [{"fixture": "one", "label": 1}, {"fixture": "two", "label": 0}])
    assert code == 0
    examples = load_jsonl(str(output))
    assert len(examples) == 2
    assert {example.label for example in examples} == {0, 1}
    assert "2 written" in capsys.readouterr().out


def test_reports_the_label_balance_and_locale_spread(tmp_path, capsys):
    write_fixture(tmp_path, "one", "https://www.amazon.com/dp/B0ABCDEF12")
    run(tmp_path, [{"fixture": "one", "label": 1}])
    out = capsys.readouterr().out
    assert "1 manipulated, 0 clean" in out
    assert "com 1" in out


def test_names_every_skipped_page_and_why(tmp_path, capsys):
    write_fixture(tmp_path, "one", "https://www.amazon.com/dp/B0ABCDEF12")
    code, _ = run(
        tmp_path,
        [{"fixture": "one", "label": 1}],
        extract=lambda html, url: extraction(reviews(4), snapshot()),
    )
    assert code == 0
    assert "skipped one: below the minimum data thresholds" in capsys.readouterr().out


# a corpus whose priors nobody recorded is a corpus nobody can retrain against
def test_says_which_priors_the_run_used(tmp_path, capsys):
    write_fixture(tmp_path, "one", "https://www.amazon.com/dp/B0ABCDEF12")
    run(tmp_path, [{"fixture": "one", "label": 1}])
    assert "schema/priors.json" in capsys.readouterr().out


def test_the_corpus_carries_no_url_or_title(tmp_path):
    write_fixture(tmp_path, "one", "https://www.amazon.com/dp/B0ABCDEF12")
    _, output = run(tmp_path, [{"fixture": "one", "label": 1}])
    written = output.read_text(encoding="utf-8")
    assert "amazon.com" not in written
    assert "knife" not in written
    assert "one" not in json.loads(written)["exampleId"]


def test_the_mapping_is_printed_only_when_asked(tmp_path, capsys):
    write_fixture(tmp_path, "one", "https://www.amazon.com/dp/B0ABCDEF12")
    label_path = labels(tmp_path / "labels.jsonl", [{"fixture": "one", "label": 1}])
    extract = lambda html, url: extraction(reviews(60), snapshot())  # noqa: E731
    main(
        [label_path, "--output", str(tmp_path / "a.jsonl"), "--fixtures", str(tmp_path)],
        extract=extract,
    )
    assert "one ->" not in capsys.readouterr().out
    main(
        [
            label_path,
            "--output",
            str(tmp_path / "b.jsonl"),
            "--fixtures",
            str(tmp_path),
            "--print-mapping",
        ],
        extract=extract,
    )
    assert f"one -> {example_id_for('one')}" in capsys.readouterr().out


def test_an_empty_label_file_is_an_error(tmp_path, capsys):
    path = tmp_path / "labels.jsonl"
    path.write_text("\n", encoding="utf-8")
    code = main([str(path), "--output", str(tmp_path / "corpus.jsonl")])
    assert code == 1
    assert "no labels" in capsys.readouterr().err


def test_a_broken_label_file_is_an_error_not_an_empty_corpus(tmp_path, capsys):
    path = tmp_path / "labels.jsonl"
    path.write_text('{"fixture": "one", "label": 7}\n', encoding="utf-8")
    code = main([str(path), "--output", str(tmp_path / "corpus.jsonl")])
    assert code == 1
    assert "expected 0 or 1" in capsys.readouterr().err


def test_a_missing_page_is_an_error_not_a_short_corpus(tmp_path, capsys):
    path = tmp_path / "labels.jsonl"
    path.write_text('{"fixture": "absent", "label": 1}\n', encoding="utf-8")
    code = main(
        [str(path), "--output", str(tmp_path / "corpus.jsonl"), "--fixtures", str(tmp_path)]
    )
    assert code == 1
    assert "does not exist" in capsys.readouterr().err


def test_an_extractor_that_cannot_run_is_reported_per_page(tmp_path, capsys):
    write_fixture(tmp_path, "one", "https://www.amazon.com/dp/B0ABCDEF12")

    def extract(html: str, url: str) -> FullExtraction:
        raise ExtractorError("extract.mjs is missing, run `just canary-extractor` to build it")

    code, _ = run(tmp_path, [{"fixture": "one", "label": 1}], extract=extract)
    assert code == 0
    assert "just canary-extractor" in capsys.readouterr().out
