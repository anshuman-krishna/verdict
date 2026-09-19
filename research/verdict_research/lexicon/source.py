import base64
import json
from collections.abc import Iterable

from verdict_research.features.embedding_backend import LEXICON_ARTIFACT_VERSION
from verdict_research.features.lexicon import DEFAULT_SCALE, build_lexicon
from verdict_research.features.text_embedding import tokenize


class SourceError(ValueError):
    pass


def reachable(token: str) -> bool:
    return tokenize(token) == [token]


def read_vectors(
    lines: Iterable[str], max_tokens: int | None = None
) -> tuple[dict[str, list[float]], int]:
    vectors: dict[str, list[float]] = {}
    skipped = 0
    dimensions: int | None = None
    for number, line in enumerate(lines, start=1):
        parts = line.split()
        if not parts:
            continue
        if number == 1 and len(parts) == 2 and all(part.isdigit() for part in parts):
            continue
        token, rest = parts[0], parts[1:]
        if len(rest) < 2:
            raise SourceError(f"line {number} carries no vector")
        if not reachable(token):
            skipped += 1
            continue
        try:
            values = [float(value) for value in rest]
        except ValueError as error:
            raise SourceError(f"line {number}: {error}") from error
        if dimensions is None:
            dimensions = len(values)
        elif len(values) != dimensions:
            raise SourceError(
                f"line {number}: {token!r} has {len(values)} values, not {dimensions}"
            )
        if token in vectors:
            skipped += 1
            continue
        vectors[token] = values
        if max_tokens is not None and len(vectors) >= max_tokens:
            break
    if not vectors:
        raise SourceError("no token in this file can be looked up by the tokenizer")
    return vectors, skipped


def artifact(identity: str, vectors: dict[str, list[float]], scale: float = DEFAULT_SCALE) -> dict:
    return {
        "artifactVersion": LEXICON_ARTIFACT_VERSION,
        "present": True,
        "identity": identity,
        "bytes": base64.b64encode(build_lexicon(vectors, scale)).decode("ascii"),
    }


def encode(value: dict) -> str:
    return json.dumps(value, indent=2, sort_keys=True) + "\n"


def fit_to_budget(
    identity: str,
    vectors: dict[str, list[float]],
    max_bytes: int | None,
    scale: float = DEFAULT_SCALE,
) -> tuple[dict[str, list[float]], int]:
    if max_bytes is None:
        return vectors, 0
    tokens = list(vectors)
    if len(encode(artifact(identity, vectors, scale)).encode("utf-8")) <= max_bytes:
        return vectors, 0

    low, high = 0, len(tokens)
    while low < high:
        middle = (low + high + 1) // 2
        kept = {token: vectors[token] for token in tokens[:middle]}
        if len(encode(artifact(identity, kept, scale)).encode("utf-8")) <= max_bytes:
            low = middle
        else:
            high = middle - 1
    if low == 0:
        raise SourceError(f"not one token of this table fits inside {max_bytes} bytes")
    return {token: vectors[token] for token in tokens[:low]}, len(tokens) - low
