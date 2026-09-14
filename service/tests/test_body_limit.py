import asyncio
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from verdict_service.api.body_limit import MAX_REQUEST_BODY_BYTES, BodySizeLimit
from verdict_service.api.contribution import (
    MAX_EDGES_PER_BATCH,
    MAX_MINHASH_DIGITS,
    MAX_MINHASH_LENGTH,
    create_contribution_router,
)
from verdict_service.graph.contribution_store import InMemoryContributionEdgeStore


def echo_app(limit: int = 16) -> TestClient:
    api = FastAPI()

    @api.post("/echo")
    async def echo(payload: dict) -> dict:
        return payload

    return TestClient(BodySizeLimit(api, limit))


def test_a_body_within_the_limit_reaches_the_application():
    response = echo_app().post(
        "/echo", content=b'{"a": 1}', headers={"content-type": "application/json"}
    )
    assert response.status_code == 200
    assert response.json() == {"a": 1}


def test_a_declared_length_over_the_limit_is_refused_before_reading():
    response = echo_app().post("/echo", content=b'{"a": "' + b"x" * 64 + b'"}')
    assert response.status_code == 413


def test_a_chunked_body_without_a_length_is_still_bounded():
    def chunks():
        for _ in range(10):
            yield b"x" * 8

    response = echo_app().post("/echo", content=chunks())
    assert response.status_code == 413


def test_a_malformed_content_length_is_a_bad_request():
    received = []

    async def run():
        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            received.append(message)

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [(b"content-length", b"lots")],
        }
        await BodySizeLimit(lambda *_: None, 16)(scope, receive, send)

    asyncio.run(run())
    assert received[0]["status"] == 400


def test_non_http_scopes_pass_straight_through():
    seen = []

    async def inner(scope, receive, send):
        seen.append(scope["type"])

    asyncio.run(BodySizeLimit(inner, 1)({"type": "lifespan"}, None, None))
    assert seen == ["lifespan"]


def largest_valid_batch() -> bytes:
    edge = {
        "reviewerHash": "a" * 64,
        "productHash": "b" * 64,
        "starRating": 5,
        "weekBucket": 5000,
        "verified": False,
        "minhashSignature": ["9" * MAX_MINHASH_DIGITS] * MAX_MINHASH_LENGTH,
    }
    return json.dumps({"edges": [edge] * MAX_EDGES_PER_BATCH}).encode()


def test_the_largest_batch_the_endpoint_accepts_fits_under_the_limit():
    body = largest_valid_batch()
    assert len(body) < MAX_REQUEST_BODY_BYTES

    store = InMemoryContributionEdgeStore()
    api = FastAPI()
    api.include_router(create_contribution_router(store, now=lambda: 1.0))
    response = TestClient(BodySizeLimit(api, MAX_REQUEST_BODY_BYTES)).post(
        "/v1/graph/contribute", content=body, headers={"content-type": "application/json"}
    )
    assert response.status_code == 200, response.text[:200]
