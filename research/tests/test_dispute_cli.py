import json

from verdict_research.dispute.cli import main
from verdict_research.dispute.document import DOCUMENT_VERSION
from verdict_research.model.combine import (
    MEDIAN_FRACTION,
    CombinerModel,
    CombinerOk,
    score_features,
)

COEFFICIENTS = {"ratingDeconvolution.injectedShare": 2.5, "temporalBurst.burstFraction": 1.25}
QUANTILES = {"temporalBurst.burstFraction": [0.0, 0.2, 0.4]}
FEATURES = {"ratingDeconvolution.injectedShare": 0.4, "temporalBurst.burstFraction": 0.6}

ARTIFACT = {
    "artifactVersion": 1,
    "present": True,
    "trainedAt": 1_690_000_000_000,
    "intercept": -1.0,
    "coefficients": COEFFICIENTS,
    "calibration": [],
    "featureQuantiles": QUANTILES,
}


def _probability():
    model = CombinerModel(
        intercept=-1.0,
        coefficients=dict(COEFFICIENTS),
        calibration=[],
        feature_quantiles={k: list(v) for k, v in QUANTILES.items()},
    )
    result = score_features(model, dict(FEATURES), impute=MEDIAN_FRACTION)
    assert isinstance(result, CombinerOk)
    return result.probability


def _document(probability):
    return {
        "documentVersion": DOCUMENT_VERSION,
        "exportedAt": 1_700_000_000_000,
        "title": "a stovetop kettle",
        "report": {
            "serial": "7F2A-0091",
            "band": "mixed",
            "probability": probability,
            "unavailableSignals": [],
            "absentSignals": ["verification pattern"],
            "provenance": {
                "extensionVersion": "0.1.0",
                "rulesSite": "amazon",
                "rulesVersion": 41,
                "modelDigest": "7KQ2M4XZ",
                "modelTrainedAt": 1_690_000_000_000,
                "embedding": "hashed-terms/256",
            },
        },
        "features": FEATURES,
    }


def _write(tmp_path, document, artifact=None):
    report = tmp_path / "report.json"
    report.write_text(json.dumps(document), encoding="utf-8")
    model = tmp_path / "model.json"
    model.write_text(json.dumps(artifact or ARTIFACT), encoding="utf-8")
    return report, model


def test_a_report_that_reproduces_exits_zero_and_says_so(tmp_path, capsys):
    report, model = _write(tmp_path, _document(_probability()))

    assert main([str(report), "--model", str(model)]) == 0

    printed = capsys.readouterr().out
    assert "reproduces exactly" in printed
    assert "7F2A-0091" in printed
    assert "ratingDeconvolution.injectedShare" in printed
    assert "the platform does not record: verification pattern" in printed
    assert "text embedded by: hashed-terms/256" in printed


def test_a_report_that_does_not_reproduce_exits_one(tmp_path, capsys):
    report, model = _write(tmp_path, _document(0.01))

    assert main([str(report), "--model", str(model)]) == 1
    assert "where the report recorded" in capsys.readouterr().out


def test_writes_the_same_finding_as_json_when_asked(tmp_path, capsys):
    report, model = _write(tmp_path, _document(_probability()))
    output = tmp_path / "finding.json"

    main([str(report), "--model", str(model), "--output", str(output)])

    written = json.loads(output.read_text(encoding="utf-8"))
    assert written["reproduces"] is True
    assert written["serial"] == "7F2A-0091"
    assert written["slot"] == "local"
    assert len(written["contributions"]) == 2
    assert capsys.readouterr().out.endswith(f"wrote {output}\n")


def test_says_which_file_it_could_not_read(tmp_path, capsys):
    assert main([str(tmp_path / "nothing.json")]) == 1
    assert "nothing.json" in capsys.readouterr().err


def test_refuses_a_document_it_cannot_recognise(tmp_path, capsys):
    report, model = _write(tmp_path, {"documentVersion": DOCUMENT_VERSION, "report": "a kettle"})

    assert main([str(report), "--model", str(model)]) == 1
    assert "carries no report" in capsys.readouterr().err


def test_says_plainly_when_this_build_has_no_model_to_rerun_against(tmp_path, capsys):
    report, model = _write(
        tmp_path, _document(0.4), {"artifactVersion": 1, "present": False, "reason": "no corpus"}
    )

    assert main([str(report), "--model", str(model)]) == 1
    assert "no model is present" in capsys.readouterr().err
