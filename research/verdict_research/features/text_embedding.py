import math

from verdict_research.features.text_near_duplication import MASK_64, fnv1a64

EMBEDDING_DIMENSIONS = 256
_SIGN_BIT = 63


def tokenize(text: str) -> list[str]:
    tokens = []
    current = ""
    for character in text.lower():
        if character.isalnum():
            current += character
            continue
        if current:
            tokens.append(current)
            current = ""
    if current:
        tokens.append(current)
    return tokens


def terms(tokens: list[str]) -> list[str]:
    result = list(tokens)
    result.extend(f"{tokens[i]} {tokens[i + 1]}" for i in range(len(tokens) - 1))
    return result


def hash_terms(text: str, dimensions: int = EMBEDDING_DIMENSIONS) -> list[int]:
    counts: dict[int, int] = {}
    for term in terms(tokenize(text)):
        hash_value = fnv1a64(term) & MASK_64
        bucket = hash_value % dimensions
        sign = -1 if (hash_value >> _SIGN_BIT) & 1 else 1
        counts[bucket] = counts.get(bucket, 0) + sign
    flat: list[int] = []
    for bucket in sorted(counts):
        flat.extend((bucket, counts[bucket]))
    return flat


def normalize_vector(vector: list[float]) -> list[float] | None:
    sum_of_squares = 0.0
    for value in vector:
        sum_of_squares += value * value
    if sum_of_squares == 0:
        return None
    norm = math.sqrt(sum_of_squares)
    return [value / norm for value in vector]


def embed_term_counts(
    counts: list[int], dimensions: int = EMBEDDING_DIMENSIONS
) -> list[float] | None:
    vector = [0.0] * dimensions
    for i in range(0, len(counts) - 1, 2):
        bucket = counts[i]
        if bucket < 0 or bucket >= dimensions:
            return None
        vector[bucket] = counts[i + 1]
    return normalize_vector(vector)


def embed_text(text: str, dimensions: int = EMBEDDING_DIMENSIONS) -> list[float] | None:
    return embed_term_counts(hash_terms(text, dimensions), dimensions)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    total = 0.0
    for i in range(len(a)):
        total += a[i] * b[i]
    return total
