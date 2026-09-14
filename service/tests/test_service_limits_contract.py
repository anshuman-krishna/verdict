import json
from pathlib import Path

from verdict_service.api.body_limit import MAX_REQUEST_BODY_BYTES
from verdict_service.api.contribution import MAX_EDGES_PER_BATCH, MAX_MINHASH_LENGTH
from verdict_service.api.reputation import BUCKET_COUNT, PREFIX_LENGTH
from verdict_service.deploy_config import read_proxy_guarantees

LIMITS = json.loads(
    (Path(__file__).resolve().parents[2] / "tests" / "contract" / "serviceLimits.json").read_text(
        encoding="utf-8"
    )
)


def test_the_batch_cap_matches_what_the_extension_chunks_to():
    assert MAX_EDGES_PER_BATCH == LIMITS["contributeMaxEdgesPerBatch"]


def test_the_body_limit_matches_the_contract():
    assert MAX_REQUEST_BODY_BYTES == LIMITS["maxRequestBodyBytes"]


def test_the_proxy_body_limit_matches_the_contract():
    assert read_proxy_guarantees().max_request_body_bytes == LIMITS["maxRequestBodyBytes"]


def test_the_lookup_shape_matches_the_contract():
    assert BUCKET_COUNT == LIMITS["lookupBucketCount"]
    assert PREFIX_LENGTH == LIMITS["lookupPrefixLength"]


def test_the_signature_cap_matches_the_contract():
    assert MAX_MINHASH_LENGTH == LIMITS["maxMinhashLength"]
