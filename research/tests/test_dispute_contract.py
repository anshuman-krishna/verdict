import json
from pathlib import Path

import pytest

from verdict_research.dispute.document import DOCUMENT_VERSION, parse_report_document
from verdict_research.dispute.reproduce import reproduce
from verdict_research.model.combine import (
    MEDIAN_FRACTION,
    CombinerModel,
    CombinerOk,
    score_features,
)

# the same file extension/tests/reportDocumentContract.spec.ts checks itself against. a
# change to it is a change to what a seller is asked to send, so neither side edits it alone
CONTRACT = Path(__file__).resolve().parents[2] / "tests" / "contract" / "reportDocument.json"


@pytest.fixture
def contract():
    return json.loads(CONTRACT.read_text(encoding="utf-8"))


def test_reads_the_document_the_extension_actually_writes(contract):
    read = parse_report_document(contract)

    assert read.document_version == DOCUMENT_VERSION
    assert read.serial == "7F2A-0091"
    assert read.title == "Stovetop Kettle, 1.7 Litre"
    assert read.band == "mixed"
    assert read.probability == pytest.approx(0.4212)
    assert read.claimed_rating == pytest.approx(4.6)
    assert read.adjusted_rating == pytest.approx(3.9)
    assert read.total_review_count == 8431
    assert read.excluded_review_count == 1208
    assert read.absent_signals == ["verification pattern"]
    assert read.unavailable_signals == ["reviewer network"]
    assert read.reproducible


def test_reads_every_feature_key_the_extension_flattens(contract):
    read = parse_report_document(contract)

    # exactly the keys flattenFeatureVector writes, so neither scorer can gain one quietly
    assert sorted(read.features) == [
        "listingDrift.driftStatistic",
        "listingDrift.meanDistance",
        "listingDrift.offTopicShare",
        "ratingDeconvolution.injectedShare",
        "ratingDeconvolution.residualError",
        "reviewerGraph.flaggedReviewShare",
        "temporalBurst.burstCount",
        "temporalBurst.burstFraction",
        "temporalBurst.largestBurstShare",
        "textNearDuplication.clusterCount",
        "textNearDuplication.duplicateReviewShare",
        "textNearDuplication.largestClusterShare",
        "verificationConcentration.lift",
    ]
    assert read.features["verificationConcentration.lift"] is None
    assert read.features["temporalBurst.burstCount"] == pytest.approx(2)


def test_keeps_the_provenance_a_dispute_is_answered_with(contract):
    provenance = parse_report_document(contract).provenance

    assert provenance is not None
    assert provenance["rulesSite"] == "amazon"
    assert provenance["rulesVersion"] == 41
    assert provenance["modelDigest"] == "7KQ2M4XZ"
    assert provenance["embedding"] == "hashed-terms/256"


def test_the_contract_document_reruns_against_a_model_built_from_its_own_keys(contract):
    read = parse_report_document(contract)
    coefficients = {key: 0.5 for key, value in read.features.items() if value is not None}
    model = CombinerModel(intercept=-1.0, coefficients=coefficients)
    scored = score_features(model, dict(read.features), impute=MEDIAN_FRACTION)
    assert isinstance(scored, CombinerOk)

    artifact = {
        "artifactVersion": 1,
        "present": True,
        "intercept": -1.0,
        "coefficients": coefficients,
        "calibration": [],
        "featureQuantiles": {},
    }
    contract["report"]["probability"] = scored.probability

    result = reproduce(parse_report_document(contract), artifact)

    assert result.agrees
    assert len(result.contributions) == len(coefficients)
