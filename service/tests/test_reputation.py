import hashlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

from verdict_service.api.reputation import BUCKET_COUNT, create_reputation_router
from verdict_service.api.store import InMemoryFlaggedHashStore


def make_client(store: InMemoryFlaggedHashStore) -> TestClient:
    app = FastAPI()
    app.include_router(create_reputation_router(store))
    return TestClient(app)


def full_hashes(count: int) -> list[str]:
    return [hashlib.sha256(f"reviewer-{i}".encode()).hexdigest() for i in range(count)]


def distinct_prefixes(count: int = BUCKET_COUNT) -> list[str]:
    return [format(i, "04x") for i in range(count)]


def test_rejects_a_request_that_is_not_exactly_32_prefixes():
    client = make_client(InMemoryFlaggedHashStore())
    response = client.post("/v1/reputation/lookup", json={"prefixes": distinct_prefixes(31)})
    assert response.status_code == 422
    assert "exactly 32" in response.text


def test_rejects_a_prefix_that_is_not_four_lowercase_hex_characters():
    client = make_client(InMemoryFlaggedHashStore())
    prefixes = distinct_prefixes(BUCKET_COUNT - 1) + ["ABCD"]
    response = client.post("/v1/reputation/lookup", json={"prefixes": prefixes})
    assert response.status_code == 422
    assert "lowercase hex" in response.text


def test_rejects_one_real_prefix_repeated_in_place_of_decoys():
    client = make_client(InMemoryFlaggedHashStore())
    response = client.post("/v1/reputation/lookup", json={"prefixes": ["3b1f"] * BUCKET_COUNT})
    assert response.status_code == 422
    assert "distinct" in response.text


def test_rejects_a_single_repeated_decoy():
    client = make_client(InMemoryFlaggedHashStore())
    prefixes = distinct_prefixes(BUCKET_COUNT - 1) + ["0000"]
    response = client.post("/v1/reputation/lookup", json={"prefixes": prefixes})
    assert response.status_code == 422


def test_returns_every_requested_prefix_as_a_key_real_or_padding_alike():
    store = InMemoryFlaggedHashStore()
    client = make_client(store)
    prefixes = [format(i, "04x") for i in range(BUCKET_COUNT)]
    response = client.post("/v1/reputation/lookup", json={"prefixes": prefixes})
    assert response.status_code == 200
    body = response.json()
    assert set(body["matches"].keys()) == set(prefixes)
    assert all(matches == [] for matches in body["matches"].values())


def test_returns_flagged_hashes_sharing_a_requested_prefix():
    store = InMemoryFlaggedHashStore()
    flagged = full_hashes(3)
    for h in flagged:
        store.add(h)

    matched_prefix = flagged[0][:4]
    padding = [p for p in (format(i, "04x") for i in range(65536)) if p != matched_prefix]
    prefixes = [matched_prefix, *padding[: BUCKET_COUNT - 1]]
    assert len(set(prefixes)) == BUCKET_COUNT

    client = make_client(store)
    response = client.post("/v1/reputation/lookup", json={"prefixes": prefixes})
    body = response.json()

    assert flagged[0] in body["matches"][matched_prefix]
    for h in flagged:
        if h.startswith(matched_prefix):
            assert h in body["matches"][matched_prefix]


def test_rejects_a_request_missing_the_prefixes_field():
    client = make_client(InMemoryFlaggedHashStore())
    response = client.post("/v1/reputation/lookup", json={})
    assert response.status_code == 422
