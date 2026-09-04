import json
from pathlib import Path

from verdict_research.features.rating_deconvolution import rating_deconvolution
from verdict_research.features.temporal_burst import detect_temporal_bursts
from verdict_research.features.verification_concentration import (
    ReviewForVerification,
    verification_concentration,
)

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

    raise ValueError(f"unknown signal in parity vectors: {signal}")


VECTORS = load_vectors()


def test_python_signals_against_the_shared_parity_vectors():
    for index, vector in enumerate(VECTORS):
        actual = run(vector)
        assert_close(actual, vector["expected"], f"vector {index}: {vector['signal']}")
