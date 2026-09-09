import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from verdict_service.api.contribution import create_contribution_router
from verdict_service.graph.contribution_store import InMemoryContributionEdgeStore

CONTRACT = Path(__file__).resolve().parents[2] / "tests" / "contract" / "contributionBatch.json"


def client(store: InMemoryContributionEdgeStore) -> TestClient:
    app = FastAPI()
    app.include_router(create_contribution_router(store, now=lambda: 1000.0))
    return TestClient(app)


def batch() -> dict:
    return json.loads(CONTRACT.read_text(encoding="utf-8"))


def test_the_endpoint_accepts_the_batch_the_extension_sends():
    store = InMemoryContributionEdgeStore()
    response = client(store).post("/v1/graph/contribute", json=batch())
    assert response.status_code == 200, response.text
    assert response.json()["accepted"] == 2


def test_every_field_arrives_with_its_value_intact():
    store = InMemoryContributionEdgeStore()
    client(store).post("/v1/graph/contribute", json=batch())
    stored = sorted(store.list_since(0.0), key=lambda e: e.star_rating)
    assert stored[1].reviewer_hash == batch()["edges"][0]["reviewerHash"]
    assert stored[1].star_rating == 5
    assert stored[1].week_bucket == 2900
    assert stored[1].verified is True
    assert stored[1].minhash_signature == ["1043", "77", "9182"]


def test_a_null_verified_flag_stays_null():
    store = InMemoryContributionEdgeStore()
    client(store).post("/v1/graph/contribute", json=batch())
    stored = sorted(store.list_since(0.0), key=lambda e: e.star_rating)
    assert stored[0].verified is None


def test_the_fixture_is_camel_case_throughout():
    for edge in batch()["edges"]:
        for key in edge:
            assert "_" not in key, key
