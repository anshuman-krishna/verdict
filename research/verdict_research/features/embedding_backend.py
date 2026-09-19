import base64
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from verdict_research.features.lexicon import Lexicon, parse_lexicon
from verdict_research.features.text_embedding import (
    EMBEDDING_DIMENSIONS,
    embed_text,
    normalize_vector,
    tokenize,
)

LEXICON_ARTIFACT_VERSION = 1

HASHED_TERMS_IDENTITY = "hashed-terms"


class EmbeddingBackend(Protocol):
    identity: str
    dimensions: int

    def embed(self, text: str) -> list[float] | None: ...


@dataclass
class HashedTermsBackend:
    dimensions: int = EMBEDDING_DIMENSIONS

    @property
    def identity(self) -> str:
        return f"{HASHED_TERMS_IDENTITY}/{self.dimensions}"

    def embed(self, text: str) -> list[float] | None:
        return embed_text(text, self.dimensions)


@dataclass
class LexiconBackend:
    lexicon: Lexicon
    identity: str

    @property
    def dimensions(self) -> int:
        return self.lexicon.dimensions

    def embed(self, text: str) -> list[float] | None:
        total = [0.0] * self.lexicon.dimensions
        found = 0
        for token in tokenize(text):
            row = self.lexicon.row(token)
            if row is None:
                continue
            found += 1
            for i in range(self.lexicon.dimensions):
                total[i] += row[i]
        if found == 0:
            return None
        return normalize_vector(total)


def hashed_terms(dimensions: int = EMBEDDING_DIMENSIONS) -> HashedTermsBackend:
    return HashedTermsBackend(dimensions=dimensions)


def from_lexicon(lexicon: Lexicon, identity: str) -> LexiconBackend:
    return LexiconBackend(lexicon=lexicon, identity=identity)


def backend_from_artifact(
    data: object, fallback: EmbeddingBackend | None = None
) -> EmbeddingBackend:
    resolved = hashed_terms() if fallback is None else fallback
    if not isinstance(data, dict):
        return resolved
    if data.get("artifactVersion") != LEXICON_ARTIFACT_VERSION or data.get("present") is not True:
        return resolved
    identity = data.get("identity")
    encoded = data.get("bytes")
    if not isinstance(identity, str) or not identity or not isinstance(encoded, str):
        return resolved
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        return resolved
    lexicon = parse_lexicon(decoded)
    if lexicon is None:
        return resolved
    return from_lexicon(lexicon, identity)


# the same file the extension bundles, because a corpus featurised with one embedding and
# scored with another is a corpus of numbers that mean nothing
BUNDLED_ARTIFACT = (
    Path(__file__).resolve().parents[3] / "extension" / "src" / "score" / "lexicon.json"
)

_bundled: EmbeddingBackend | None = None


def _read(path: Path) -> EmbeddingBackend:
    try:
        return backend_from_artifact(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError):
        return hashed_terms()


def bundled_embedding_backend(path: Path | None = None) -> EmbeddingBackend:
    global _bundled
    if path is not None:
        return _read(path)
    if _bundled is None:
        _bundled = _read(BUNDLED_ARTIFACT)
    return _bundled
