import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from verdict_research.features.feature_vector import FeatureVectorInputs

_PRIORS_PATH = Path(__file__).parents[3] / "schema" / "priors.json"

with open(_PRIORS_PATH, encoding="utf-8") as _handle:
    _PRIORS = json.load(_handle)

DEFAULT_ORGANIC_PRIOR: list[float] = [float(v) for v in _PRIORS["default"]["organicPrior"]]
DEFAULT_INJECTION_KERNEL: list[float] = [float(v) for v in _PRIORS["default"]["injectionKernel"]]

_ALIASES: dict[str, str] = dict(_PRIORS.get("aliases", {}))
_CATEGORIES: dict[str, dict] = dict(_PRIORS.get("categories", {}))

_TRAIL_SEPARATORS = re.compile(r"[>›»→/|\n]+")
_MAX_ALIAS_HOPS = 4


# the same reduction as extension/src/score/categoryKey.ts, because a corpus grouped
# one way and scored another way is measuring nothing
def category_slug(segment: str) -> str:
    kept: list[str] = []
    parts: list[str] = []
    for character in unicodedata.normalize("NFKC", segment).lower():
        if unicodedata.category(character)[0] in ("L", "N", "M"):
            kept.append(character)
            continue
        if kept:
            parts.append("".join(kept))
            kept = []
    if kept:
        parts.append("".join(kept))
    return "-".join(parts)


def category_keys(category: str | None) -> list[str]:
    if category is None:
        return []
    keys: list[str] = []
    seen: set[str] = set()
    for segment in reversed(_TRAIL_SEPARATORS.split(category)):
        key = category_slug(segment)
        if not key or key in seen:
            continue
        seen.add(key)
        keys.append(key)
    return keys


@dataclass(frozen=True)
class ResolvedPriors:
    inputs: FeatureVectorInputs
    key: str | None


def default_priors(product_text: str = "") -> FeatureVectorInputs:
    return FeatureVectorInputs(
        organic_prior=list(DEFAULT_ORGANIC_PRIOR),
        injection_kernel=list(DEFAULT_INJECTION_KERNEL),
        product_text=product_text,
    )


def _follow_aliases(key: str) -> str:
    current = key
    for _ in range(_MAX_ALIAS_HOPS):
        following = _ALIASES.get(current)
        if following is None or following == current:
            return current
        current = following
    return current


def priors_category_keys() -> list[str]:
    return sorted(_CATEGORIES)


def priors_for(category: str | None, product_text: str = "") -> ResolvedPriors:
    for candidate in category_keys(category):
        key = _follow_aliases(candidate)
        entry = _CATEGORIES.get(key)
        if entry is None:
            continue
        return ResolvedPriors(
            inputs=FeatureVectorInputs(
                organic_prior=[float(v) for v in entry["organicPrior"]],
                injection_kernel=[
                    float(v) for v in entry.get("injectionKernel", DEFAULT_INJECTION_KERNEL)
                ],
                product_text=product_text,
            ),
            key=key,
        )
    return ResolvedPriors(inputs=default_priors(product_text), key=None)


def priors_digest(inputs: FeatureVectorInputs) -> str:
    canonical = json.dumps(
        {"organicPrior": inputs.organic_prior, "injectionKernel": inputs.injection_kernel},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:8]


# every prior a row could have been featurised against, so an audit can tell a stale
# corpus from a retuned one
def known_priors_digests() -> set[str]:
    digests = {priors_digest(default_priors())}
    for key in _CATEGORIES:
        digests.add(priors_digest(priors_for(key).inputs))
    return digests


# over the whole document, so model.json can record which priors trained it
def priors_document_digest() -> str:
    canonical = json.dumps(
        {
            "default": {
                "organicPrior": DEFAULT_ORGANIC_PRIOR,
                "injectionKernel": DEFAULT_INJECTION_KERNEL,
            },
            "aliases": _ALIASES,
            "categories": _CATEGORIES,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:8]
