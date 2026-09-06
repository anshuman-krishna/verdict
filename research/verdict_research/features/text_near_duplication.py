import json
from dataclasses import dataclass
from pathlib import Path

# a mersenne prime, large enough that fnv1a64 hashes reduce into it with
# negligible bias, small enough that a*h stays exact under python's
# arbitrary precision integers either way
MODULUS = (1 << 61) - 1

FNV_OFFSET_BASIS = 14695981039346656037
FNV_PRIME = 1099511628211
MASK_64 = (1 << 64) - 1

DEFAULT_SHINGLE_SIZE = 5
DEFAULT_NUM_PERMUTATIONS = 128
DEFAULT_BANDS = 32
DEFAULT_ROWS = 4
DEFAULT_JACCARD_THRESHOLD = 0.7

_COEFFICIENTS_PATH = Path(__file__).parents[3] / "schema" / "minhash-coefficients.json"
with open(_COEFFICIENTS_PATH) as f:
    # coefficients are stored as decimal strings because they exceed a
    # javascript safe integer, and a plain json import there would round them
    COEFFICIENTS: list[tuple[int, int]] = [(int(a), int(b)) for a, b in json.load(f)]


@dataclass
class ReviewForNearDuplication:
    text: str | None


@dataclass
class TextNearDuplicationResult:
    duplicate_review_share: float | None
    cluster_count: int
    largest_cluster_share: float


def fnv1a64(text: str) -> int:
    hash_value = FNV_OFFSET_BASIS
    for byte in text.encode("utf-8"):
        hash_value ^= byte
        hash_value = (hash_value * FNV_PRIME) & MASK_64
    return hash_value


def shingle(text: str, shingle_size: int) -> set[str]:
    normalized = " ".join(text.lower().split())
    if len(normalized) <= shingle_size:
        return {normalized}
    return {normalized[i : i + shingle_size] for i in range(len(normalized) - shingle_size + 1)}


def exact_jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 1.0
    intersection = len(a & b)
    union = len(a) + len(b) - intersection
    return intersection / union if union else 0.0


def minhash_signature(shingles: set[str], num_permutations: int) -> list[int]:
    if num_permutations > len(COEFFICIENTS):
        raise ValueError(f"numPermutations exceeds the {len(COEFFICIENTS)} shared coefficients")
    hashes = [fnv1a64(value) % MODULUS for value in shingles]
    signature = []
    for a, b in COEFFICIENTS[:num_permutations]:
        signature.append(min((a * h + b) % MODULUS for h in hashes))
    return signature


def estimate_jaccard(signature_a: list[int], signature_b: list[int]) -> float:
    matches = sum(1 for x, y in zip(signature_a, signature_b, strict=True) if x == y)
    return matches / len(signature_a)


class _UnionFind:
    def __init__(self, size: int) -> None:
        self.parent = list(range(size))

    def find(self, x: int) -> int:
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, x: int, y: int) -> None:
        root_x, root_y = self.find(x), self.find(y)
        if root_x != root_y:
            self.parent[root_x] = root_y


# SPEC.md 5.4: minhash with 128 permutations over character 5 grams, banded
# lsh, cluster reviews above 0.7 jaccard similarity. bands and rows and the
# output shape are not specified there; this is a proposal, not a ratified
# spec line.
def text_near_duplication(
    reviews: list[ReviewForNearDuplication],
    shingle_size: int = DEFAULT_SHINGLE_SIZE,
    num_permutations: int = DEFAULT_NUM_PERMUTATIONS,
    bands: int = DEFAULT_BANDS,
    rows: int = DEFAULT_ROWS,
    jaccard_threshold: float = DEFAULT_JACCARD_THRESHOLD,
) -> TextNearDuplicationResult:
    eligible = [review.text for review in reviews if review.text]
    if len(eligible) < 2:
        share = None if len(eligible) == 0 else 0.0
        return TextNearDuplicationResult(
            duplicate_review_share=share, cluster_count=0, largest_cluster_share=0.0
        )

    signatures = [
        minhash_signature(shingle(text, shingle_size), num_permutations) for text in eligible
    ]

    buckets: dict[tuple[int, tuple[int, ...]], list[int]] = {}
    for band in range(bands):
        start = band * rows
        for i, signature in enumerate(signatures):
            key = (band, tuple(signature[start : start + rows]))
            buckets.setdefault(key, []).append(i)

    union_find = _UnionFind(len(signatures))
    candidate_pairs: set[tuple[int, int]] = set()
    for bucket in buckets.values():
        if len(bucket) < 2:
            continue
        for i in range(len(bucket)):
            for j in range(i + 1, len(bucket)):
                candidate_pairs.add((bucket[i], bucket[j]))

    for left, right in candidate_pairs:
        similarity = estimate_jaccard(signatures[left], signatures[right])
        if similarity > jaccard_threshold:
            union_find.union(left, right)

    cluster_sizes: dict[int, int] = {}
    for i in range(len(signatures)):
        root = union_find.find(i)
        cluster_sizes[root] = cluster_sizes.get(root, 0) + 1

    duplicate_review_count = 0
    cluster_count = 0
    largest_cluster_size = 0
    for size in cluster_sizes.values():
        if size >= 2:
            duplicate_review_count += size
            cluster_count += 1
            largest_cluster_size = max(largest_cluster_size, size)

    return TextNearDuplicationResult(
        duplicate_review_share=duplicate_review_count / len(eligible),
        cluster_count=cluster_count,
        largest_cluster_share=largest_cluster_size / len(eligible),
    )
