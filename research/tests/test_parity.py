import json
from pathlib import Path

from verdict_research.features.feature_vector import FeatureVectorInputs, build_feature_vector
from verdict_research.features.rating_deconvolution import rating_deconvolution
from verdict_research.features.temporal_burst import detect_temporal_bursts
from verdict_research.features.text_near_duplication import (
    ReviewForNearDuplication,
    estimate_jaccard,
    minhash_signature,
    shingle,
    text_near_duplication,
)
from verdict_research.features.verification_concentration import (
    ReviewForVerification,
    verification_concentration,
)
from verdict_research.schema import Review

VECTORS_PATH = Path(__file__).parent.parent.parent / "tests" / "parity" / "vectors.jsonl"
CONTINUOUS_TOLERANCE = 1e-6


def load_vectors():
    with open(VECTORS_PATH) as f:
        return [json.loads(line) for line in f if line.strip()]


def assert_close(actual, expected, path):
    if isinstance(expected, bool) or isinstance(actual, bool):
        assert actual == expected, f"{path}: {actual} vs {expected}"
        return
    if isinstance(expected, int | float) and isinstance(actual, int | float):
        assert abs(actual - expected) <= CONTINUOUS_TOLERANCE, f"{path}: {actual} vs {expected}"
        return
    if isinstance(expected, list) and isinstance(actual, list):
        assert len(actual) == len(expected), f"{path}.length"
        for i, value in enumerate(expected):
            assert_close(actual[i], value, f"{path}[{i}]")
        return
    if isinstance(expected, dict) and isinstance(actual, dict):
        for key in expected:
            assert_close(actual.get(key), expected[key], f"{path}.{key}")
        return
    assert actual == expected, f"{path}: {actual} vs {expected}"


def run(vector: dict):
    signal = vector["signal"]
    data = vector["input"]

    if signal == "ratingDeconvolution":
        result = rating_deconvolution(
            data["observed"], data["organicPrior"], data["injectionKernel"]
        )
        return {"injectedShare": result.injected_share, "residualError": result.residual_error}

    if signal == "verificationConcentration":
        reviews = [
            ReviewForVerification(
                rating=r["rating"], verified=r["verified"], inside_burst=r["insideBurst"]
            )
            for r in data["reviews"]
        ]
        result = verification_concentration(reviews)
        return {"lift": result.lift, "baseCount": result.base_count}

    if signal == "temporalBurst":
        result = detect_temporal_bursts(data["dailyCounts"], data["windowDays"], data["percentile"])
        return {
            "bursts": [
                {"startDay": b.start_day, "endDay": b.end_day, "reviewCount": b.review_count}
                for b in result.bursts
            ],
            "burstFraction": result.burst_fraction,
            "burstCount": result.burst_count,
            "largestBurstShare": result.largest_burst_share,
        }

    if signal == "textNearDuplication":
        reviews = [ReviewForNearDuplication(text=r["text"]) for r in data["reviews"]]
        result = text_near_duplication(reviews)
        return {
            "duplicateReviewShare": result.duplicate_review_share,
            "clusterCount": result.cluster_count,
            "largestClusterShare": result.largest_cluster_share,
        }

    if signal == "textNearDuplicationEstimatedJaccard":
        signature_a = minhash_signature(shingle(data["textA"], 5), data["numPermutations"])
        signature_b = minhash_signature(shingle(data["textB"], 5), data["numPermutations"])
        return {"estimatedJaccard": estimate_jaccard(signature_a, signature_b)}

    if signal == "featureVector":
        reviews = [
            Review(
                rating=r["rating"],
                text=r["text"],
                date=r["date"],
                verified=r["verified"],
                reviewer_id=r["reviewerId"],
            )
            for r in data["reviews"]
        ]
        result = build_feature_vector(
            reviews,
            FeatureVectorInputs(
                organic_prior=data["organicPrior"], injection_kernel=data["injectionKernel"]
            ),
        )
        return {
            "meetsMinimumData": result.meets_minimum_data,
            "ratingDeconvolution": {
                "injectedShare": result.rating_deconvolution.injected_share,
                "residualError": result.rating_deconvolution.residual_error,
            }
            if result.rating_deconvolution is not None
            else None,
            "temporalBurst": {
                "burstFraction": result.temporal_burst.burst_fraction,
                "burstCount": result.temporal_burst.burst_count,
                "largestBurstShare": result.temporal_burst.largest_burst_share,
            }
            if result.temporal_burst is not None
            else None,
            "verificationConcentration": {
                "lift": result.verification_concentration.lift,
                "baseCount": result.verification_concentration.base_count,
            }
            if result.verification_concentration is not None
            else None,
            "textNearDuplication": {
                "duplicateReviewShare": result.text_near_duplication.duplicate_review_share,
                "clusterCount": result.text_near_duplication.cluster_count,
                "largestClusterShare": result.text_near_duplication.largest_cluster_share,
            },
        }

    raise ValueError(f"unknown signal in parity vectors: {signal}")


VECTORS = load_vectors()


def test_python_signals_against_the_shared_parity_vectors():
    for index, vector in enumerate(VECTORS):
        actual = run(vector)
        assert_close(actual, vector["expected"], f"vector {index}: {vector['signal']}")
