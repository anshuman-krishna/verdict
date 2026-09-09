import json

import pytest

from verdict_research.corpus.dataset import LabeledExample
from verdict_research.model.artifact import ArtifactError, build_model_artifact, place_in_slot
from verdict_research.model.audit import audit_artifact
from verdict_research.model.audit_cli import main
from verdict_research.model.combine import CalibrationPoint, CombinerModel

MODEL = CombinerModel(
    intercept=-4,
    coefficients={"ratingDeconvolution.injectedShare": 8},
    calibration=[CalibrationPoint(0, 0), CalibrationPoint(1, 1)],
)


def artifact(model: CombinerModel = MODEL) -> dict:
    return build_model_artifact(model, trained_at=0.0, acceptance={})


def examples(count: int = 20) -> list[LabeledExample]:
    rows = []
    for index in range(count):
        manipulated = index % 2 == 0
        rows.append(
            LabeledExample(
                example_id=f"row-{index}",
                features={"ratingDeconvolution.injectedShare": 0.9 if manipulated else 0.1},
                label=1 if manipulated else 0,
                metadata={"priors": "c31377c5"},
            )
        )
    return rows


def test_scores_the_shipped_model_without_refitting():
    audit = audit_artifact(artifact(), examples())

    assert audit.report.evaluated_count == 20
    assert audit.model.coefficients == MODEL.coefficients
    assert audit.problems == []


def test_counts_rows_the_model_has_no_feature_for():
    thin = [
        LabeledExample(example_id="thin", features={"temporalBurst.burstCount": 3}, label=1),
        *examples(),
    ]

    assert audit_artifact(artifact(), thin).report.skipped_missing_features_count == 1


def test_names_the_criteria_a_shipped_model_no_longer_meets():
    useless = CombinerModel(intercept=0, coefficients={"ratingDeconvolution.injectedShare": 0})

    problems = audit_artifact(artifact(useless), examples()).problems

    assert problems
    assert any("calibration error" in problem or "precision" in problem for problem in problems)


def test_flags_a_corpus_featurised_under_other_priors():
    rows = examples()
    rows[0].metadata["priors"] = "00000000"

    assert audit_artifact(artifact(), rows).priors_match is False


def test_refuses_an_artifact_that_states_no_model():
    with pytest.raises(ArtifactError):
        audit_artifact({"artifactVersion": 1, "present": False, "reason": "none"}, examples())


def test_refuses_an_empty_corpus():
    with pytest.raises(ArtifactError):
        audit_artifact(artifact(), [])


def test_refuses_a_graph_slot_the_artifact_does_not_carry():
    with pytest.raises(ArtifactError):
        audit_artifact(artifact(), examples(), "reviewerGraph")


def test_audits_the_graph_slot_when_the_artifact_carries_one():
    both = place_in_slot(artifact(), "reviewerGraph", MODEL, trained_at=1.0, acceptance={})

    assert audit_artifact(both, examples(), "reviewerGraph").report.evaluated_count == 20


def _write(tmp_path, rows, model):
    corpus = tmp_path / "corpus.jsonl"
    corpus.write_text(
        "\n".join(
            json.dumps(
                {
                    "exampleId": row.example_id,
                    "features": row.features,
                    "label": row.label,
                    "metadata": row.metadata,
                }
            )
            for row in rows
        )
        + "\n",
        encoding="utf-8",
    )
    path = tmp_path / "model.json"
    path.write_text(json.dumps(model), encoding="utf-8")
    return corpus, path


def test_cli_exits_zero_when_the_shipped_model_still_holds(tmp_path, capsys):
    corpus, model = _write(tmp_path, examples(), artifact())

    assert main([str(corpus), "--model", str(model)]) == 0
    assert "still meets every section 14 criterion" in capsys.readouterr().out


def test_cli_exits_one_and_names_the_problem(tmp_path, capsys):
    useless = CombinerModel(intercept=0, coefficients={"ratingDeconvolution.injectedShare": 0})
    corpus, model = _write(tmp_path, examples(), artifact(useless))

    assert main([str(corpus), "--model", str(model)]) == 1
    assert "does not meet section 14" in capsys.readouterr().out


def test_cli_never_writes_the_model_it_read(tmp_path):
    corpus, model = _write(tmp_path, examples(), artifact())
    before = model.read_text(encoding="utf-8")

    main([str(corpus), "--model", str(model)])

    assert model.read_text(encoding="utf-8") == before


def test_cli_writes_a_json_result_when_asked(tmp_path):
    corpus, model = _write(tmp_path, examples(), artifact())
    out = tmp_path / "audit.json"

    main([str(corpus), "--model", str(model), "--output", str(out)])

    assert json.loads(out.read_text(encoding="utf-8"))["meetsCriteria"] is True


def test_cli_reports_an_unreadable_model_file(tmp_path, capsys):
    corpus, _ = _write(tmp_path, examples(), artifact())

    assert main([str(corpus), "--model", str(tmp_path / "missing.json")]) == 1
    assert capsys.readouterr().err
