import math

from verdict_research.features.text_near_duplication import MASK_64, fnv1a64

# the mirror of extension/src/score/textEmbedding.ts. SPEC.md 5.4 asks for a quantised sentence
# embedding model in wasm; that model does not exist in this repository and section 16 open question
# 2 is still open on whether 0.1 pays its bundle cost, so this signed hashing projection over word
# unigrams and bigrams is the bundled default. it is lexical, not semantic.

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


# bigrams as well as unigrams: "phone case" and "case phone" are different products, and a bag of
# single words cannot tell them apart
def terms(tokens: list[str]) -> list[str]:
    result = list(tokens)
    result.extend(f"{tokens[i]} {tokens[i + 1]}" for i in range(len(tokens) - 1))
    return result


# flat pairs of bucket and signed count, ascending by bucket. the extension persists this form
# rather than the dense vector; here it is only a step on the way to one.
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


# none when nothing hashed, or when every term cancelled against a collision of the opposite sign,
# so a caller never divides by a zero norm
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


# both arguments are unit vectors from embed_text, so this is a plain dot product
def cosine_similarity(a: list[float], b: list[float]) -> float:
    total = 0.0
    for i in range(len(a)):
        total += a[i] * b[i]
    return total
