import math
import struct
from dataclasses import dataclass, field

LEXICON_MAGIC = b"VLEX"
LEXICON_VERSION = 1
LEXICON_HEADER_BYTES = 20

DEFAULT_SCALE = 1.0 / 127.0
_QUANTISED_LIMIT = 127

_HEADER = struct.Struct("<4sHHIfI")


class LexiconError(ValueError):
    pass


@dataclass
class Lexicon:
    version: int
    dimensions: int
    scale: float
    tokens: list[str]
    rows: bytes
    _index: dict[str, int] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        self._index = {token: position for position, token in enumerate(self.tokens)}

    @property
    def token_count(self) -> int:
        return len(self.tokens)

    def row(self, token: str) -> list[float] | None:
        position = self._index.get(token)
        if position is None:
            return None
        start = position * self.dimensions
        raw = self.rows[start : start + self.dimensions]
        return [_signed(byte) * self.scale for byte in raw]


def _signed(byte: int) -> int:
    return byte - 256 if byte > 127 else byte


def parse_lexicon(data: bytes) -> Lexicon | None:
    if len(data) < LEXICON_HEADER_BYTES:
        return None
    magic, version, dimensions, token_count, scale, token_bytes = _HEADER.unpack_from(data, 0)
    if magic != LEXICON_MAGIC:
        return None
    if version != LEXICON_VERSION or dimensions == 0 or token_count == 0 or scale <= 0:
        return None

    rows_at = LEXICON_HEADER_BYTES + token_bytes
    if len(data) != rows_at + token_count * dimensions:
        return None

    tokens = data[LEXICON_HEADER_BYTES:rows_at].decode("utf-8").split("\n")
    if len(tokens) != token_count or len(set(tokens)) != token_count:
        return None
    if any(token == "" for token in tokens):
        return None

    return Lexicon(
        version=version,
        dimensions=dimensions,
        scale=scale,
        tokens=tokens,
        rows=data[rows_at:],
    )


def build_lexicon(vectors: dict[str, list[float]], scale: float = DEFAULT_SCALE) -> bytes:
    if not vectors:
        raise LexiconError("a lexicon with no tokens would embed nothing")
    dimensions = len(next(iter(vectors.values())))
    if dimensions == 0:
        raise LexiconError("a lexicon needs at least one dimension")
    if dimensions > 0xFFFF:
        raise LexiconError(f"{dimensions} dimensions does not fit the header")

    stored = struct.unpack("<f", struct.pack("<f", scale))[0]
    if stored <= 0:
        raise LexiconError("scale has to be positive")

    tokens = list(vectors)
    for token in tokens:
        if token == "" or "\n" in token:
            raise LexiconError(f"{token!r} cannot be stored in a newline separated table")

    rows = bytearray()
    for token in tokens:
        values = vectors[token]
        if len(values) != dimensions:
            raise LexiconError(f"{token!r} has {len(values)} values, not {dimensions}")
        for value in _unit(values):
            rows.append(_quantise(value / stored) & 0xFF)

    names = "\n".join(tokens).encode("utf-8")
    header = _HEADER.pack(
        LEXICON_MAGIC, LEXICON_VERSION, dimensions, len(tokens), stored, len(names)
    )
    return bytes(header + names + rows)


def _unit(values: list[float]) -> list[float]:
    total = math.sqrt(sum(value * value for value in values))
    if total == 0:
        return list(values)
    return [value / total for value in values]


def _quantise(value: float) -> int:
    rounded = math.floor(value + 0.5) if value >= 0 else math.ceil(value - 0.5)
    return max(-_QUANTISED_LIMIT, min(_QUANTISED_LIMIT, rounded))
