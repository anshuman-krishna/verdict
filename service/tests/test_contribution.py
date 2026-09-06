import hashlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

from verdict_service.api.contribution import (
    MAX_EDGES_PER_BATCH,
    MAX_MINHASH_LENGTH,
    create_contribution_router,
)
from verdict_service.graph.contribution_store import InMemoryContributionEdgeStore


def make_client(store: InMemoryContributionEdgeStore, now=lambda: 1_000_000.0) -> TestClient:
    app = FastAPI()
    app.include_router(create_contribution_router(store, now=now))
    return TestClient(app)


def hex64(seed: str) -> str:
    return hashlib.sha256(seed.encode()).hexdigest()


def valid_edge(**overrides) -> dict:
    edge = {
        "reviewer_hash": hex64("reviewer-1"),
        "product_hash": hex64("product-1"),
        "star_rating": 5,
        "week_bucket": 2800,
        "verified": True,
        "minhash_signature": ["1", "2", "3"],
    }
    edge.update(overrides)
    return edge


def test_accepts_a_valid_batch_and_reports_how_many_edges_it_accepted():
    store = InMemoryContributionEdgeStore()
    client = make_client(store)
    response = client.post("/v1/graph/contribute", json={"edges": [valid_edge(), valid_edge()]})
    assert response.status_code == 200
    assert response.json() == {"accepted": 2}
    assert len(store.list_since(0)) == 2


def test_stamps_every_edge_with_the_server_clock_never_a_client_supplied_time():
    store = InMemoryContributionEdgeStore()
    client = make_client(store, now=lambda: 42.0)
    client.post("/v1/graph/contribute", json={"edges": [valid_edge()]})
    [stored] = store.list_since(0)
    assert stored.received_at == 42.0


def test_never_persists_anything_beyond_the_fields_privacy_md_names():
    store = InMemoryContributionEdgeStore()
    client = make_client(store)
    client.post("/v1/graph/contribute", json={"edges": [valid_edge()]})
    [stored] = store.list_since(0)
    assert set(vars(stored).keys()) == {
        "reviewer_hash",
        "product_hash",
        "star_rating",
        "week_bucket",
        "verified",
        "minhash_signature",
        "received_at",
    }


def test_rejects_a_reviewer_hash_that_is_not_64_lowercase_hex_characters():
    client = make_client(InMemoryContributionEdgeStore())
    response = client.post(
        "/v1/graph/contribute", json={"edges": [valid_edge(reviewer_hash="not-a-hash")]}
    )
    assert response.status_code == 422


def test_rejects_an_uppercase_hash_since_the_client_only_ever_produces_lowercase():
    client = make_client(InMemoryContributionEdgeStore())
    response = client.post(
        "/v1/graph/contribute", json={"edges": [valid_edge(product_hash=hex64("x").upper())]}
    )
    assert response.status_code == 422


def test_rejects_a_star_rating_outside_one_to_five():
    client = make_client(InMemoryContributionEdgeStore())
    response = client.post("/v1/graph/contribute", json={"edges": [valid_edge(star_rating=0)]})
    assert response.status_code == 422
    response = client.post("/v1/graph/contribute", json={"edges": [valid_edge(star_rating=6)]})
    assert response.status_code == 422


def test_rejects_a_minhash_signature_longer_than_the_extension_could_ever_produce():
    client = make_client(InMemoryContributionEdgeStore())
    too_long = [str(i) for i in range(MAX_MINHASH_LENGTH + 1)]
    response = client.post(
        "/v1/graph/contribute", json={"edges": [valid_edge(minhash_signature=too_long)]}
    )
    assert response.status_code == 422


def test_rejects_a_minhash_signature_entry_that_is_not_a_decimal_digit_string():
    client = make_client(InMemoryContributionEdgeStore())
    response = client.post(
        "/v1/graph/contribute",
        json={"edges": [valid_edge(minhash_signature=["not-a-number"])]},
    )
    assert response.status_code == 422


def test_accepts_an_edge_with_no_text_at_all_as_an_empty_signature():
    store = InMemoryContributionEdgeStore()
    client = make_client(store)
    response = client.post(
        "/v1/graph/contribute", json={"edges": [valid_edge(minhash_signature=[])]}
    )
    assert response.status_code == 200
    assert store.list_since(0)[0].minhash_signature == []


def test_rejects_an_empty_batch():
    client = make_client(InMemoryContributionEdgeStore())
    response = client.post("/v1/graph/contribute", json={"edges": []})
    assert response.status_code == 422


def test_rejects_a_batch_larger_than_the_defensive_cap():
    client = make_client(InMemoryContributionEdgeStore())
    edges = [valid_edge() for _ in range(MAX_EDGES_PER_BATCH + 1)]
    response = client.post("/v1/graph/contribute", json={"edges": edges})
    assert response.status_code == 422


def test_rejects_a_request_missing_the_edges_field():
    client = make_client(InMemoryContributionEdgeStore())
    response = client.post("/v1/graph/contribute", json={})
    assert response.status_code == 422
