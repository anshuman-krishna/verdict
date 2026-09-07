import json

from verdict_research.corpus.dataset import LabeledExample, save_jsonl
from verdict_research.model.cli import clear, main

# synthetic, as in test_model_pipeline.py: this checks the command's
# refusals and its output paths, not any claim about a real listing.


def corpus_file(tmp_path, count: int = 400, separable: bool = True) -> str:
    examples = [
        LabeledExample(
            example_id=str(index),
            features={"signal": (0.9 if index % 2 == 0 else 0.1) if separable else 0.5},
            label=index % 2,
        )
        for index in range(count)
    ]
    path = tmp_path / "corpus.jsonl"
    save_jsonl(examples, str(path))
    return str(path)


def test_exports_a_model_that_meets_the_criteria(tmp_path, capsys):
    output = tmp_path / "model.json"
    code = main([corpus_file(tmp_path), "--features", "signal", "--output", str(output)])
    assert code == 0
    artifact = json.loads(output.read_text(encoding="utf-8"))
    assert artifact["present"] is True
    assert artifact["acceptance"]["meetsCriteria"] is True
    assert artifact["coefficients"]["signal"] != 0.0
    assert "meets every section 14 criterion" in capsys.readouterr().out


def test_refuses_to_write_a_model_that_misses_a_criterion(tmp_path, capsys):
    output = tmp_path / "model.json"
    code = main(
        [corpus_file(tmp_path, separable=False), "--features", "signal", "--output", str(output)]
    )
    assert code == 1
    assert not output.exists()
    assert "does not meet section 14" in capsys.readouterr().out


def test_writes_a_missing_model_only_when_told_to_and_records_that_it_missed(tmp_path):
    output = tmp_path / "model.json"
    code = main(
        [
            corpus_file(tmp_path, separable=False),
            "--features",
            "signal",
            "--output",
            str(output),
            "--write-below-criteria",
        ]
    )
    assert code == 0
    assert json.loads(output.read_text(encoding="utf-8"))["acceptance"]["meetsCriteria"] is False


def test_requires_a_feature_choice(tmp_path, capsys):
    code = main([corpus_file(tmp_path), "--output", str(tmp_path / "model.json")])
    assert code == 1
    assert "--features is required" in capsys.readouterr().err


def test_lists_the_features_the_corpus_carries(tmp_path, capsys):
    code = main([corpus_file(tmp_path), "--list-features"])
    assert code == 0
    assert capsys.readouterr().out.strip() == "signal"


def test_refuses_an_empty_corpus(tmp_path, capsys):
    path = tmp_path / "empty.jsonl"
    path.write_text("", encoding="utf-8")
    code = main([str(path), "--features", "signal"])
    assert code == 1
    assert "no examples" in capsys.readouterr().err


def test_writes_the_evaluation_report_beside_the_model(tmp_path):
    report = tmp_path / "eval.json"
    main(
        [
            corpus_file(tmp_path),
            "--features",
            "signal",
            "--output",
            str(tmp_path / "model.json"),
            "--eval-output",
            str(report),
        ]
    )
    data = json.loads(report.read_text(encoding="utf-8"))
    assert data["acceptance"]["featureNames"] == ["signal"]
    assert data["curve"]


def test_clear_restores_the_stated_absent_form(tmp_path):
    output = tmp_path / "model.json"
    assert clear(["--output", str(output), "--reason", "retired"]) == 0
    artifact = json.loads(output.read_text(encoding="utf-8"))
    assert artifact["present"] is False
    assert artifact["reason"] == "retired"


# the /method page publishes these numbers, so they come from the same run that produced the model:
# a second command to remember is a page that eventually describes a different model.
def test_training_writes_the_method_document_beside_the_model(tmp_path):
    model = tmp_path / "model.json"
    method = tmp_path / "methodEvaluation.json"
    code = main(
        [
            corpus_file(tmp_path),
            "--features",
            "signal",
            "--output",
            str(model),
            "--method-output",
            str(method),
        ]
    )
    assert code == 0
    document = json.loads(method.read_text(encoding="utf-8"))
    assert document["published"] is True
    assert document["coefficients"] == json.loads(model.read_text(encoding="utf-8"))["coefficients"]


def test_a_refused_model_publishes_no_method_document(tmp_path):
    method = tmp_path / "methodEvaluation.json"
    code = main(
        [
            corpus_file(tmp_path, separable=False),
            "--features",
            "signal",
            "--output",
            str(tmp_path / "model.json"),
            "--method-output",
            str(method),
        ]
    )
    assert code == 1
    assert not method.exists()


def test_clear_restores_both_documents(tmp_path):
    model = tmp_path / "model.json"
    method = tmp_path / "methodEvaluation.json"
    main(
        [
            corpus_file(tmp_path),
            "--features",
            "signal",
            "--output",
            str(model),
            "--method-output",
            str(method),
        ]
    )
    assert (
        clear(["--output", str(model), "--method-output", str(method), "--reason", "retired"]) == 0
    )
    assert json.loads(method.read_text(encoding="utf-8"))["published"] is False
    assert json.loads(model.read_text(encoding="utf-8"))["present"] is False
