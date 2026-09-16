import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from verdict_research.corpus.featurise import (
    Extract,
    LabeledFixture,
    read_fixture_url,
)
from verdict_research.features.feature_vector import build_rating_histogram
from verdict_research.features.priors import (
    DEFAULT_INJECTION_KERNEL,
    category_keys,
)
from verdict_research.shipped_extractor import ExtractorError

# SPEC.md 5.1 estimates the organic shape from the negative corpus, so only listings
# anshuman labelled clean are read here, and a listing contributes to every level of
# its trail, which is what lets a narrow category fall back to a wide one
CLEAN = 0

# proposals, not settled numbers: below these a five bin shape is noise
DEFAULT_MIN_LISTINGS = 5
DEFAULT_MIN_REVIEWS = 500


@dataclass
class _Accumulator:
    histograms: list[list[float]] = field(default_factory=list)
    reviews: int = 0


@dataclass(frozen=True)
class CategoryEstimate:
    key: str
    organic_prior: list[float]
    listing_count: int
    review_count: int


@dataclass(frozen=True)
class Thin:
    key: str
    reason: str


@dataclass(frozen=True)
class PriorsFit:
    estimates: list[CategoryEstimate]
    thin: list[Thin]
    skipped: list[str]
    clean_listings: int
    default: CategoryEstimate | None


DEFAULT_KEY = "default"


def _mean(histograms: list[list[float]]) -> list[float]:
    # one listing, one vote, so a listing with forty thousand reviews does not become
    # the category on its own
    return [sum(values) / len(histograms) for values in zip(*histograms, strict=True)]


def _estimate(key: str, held: _Accumulator) -> CategoryEstimate:
    return CategoryEstimate(
        key=key,
        organic_prior=_mean(held.histograms),
        listing_count=len(held.histograms),
        review_count=held.reviews,
    )


def fit_priors(
    labels: list[LabeledFixture],
    fixtures: Path,
    extract: Extract,
    *,
    min_listings: int = DEFAULT_MIN_LISTINGS,
    min_reviews: int = DEFAULT_MIN_REVIEWS,
) -> PriorsFit:
    held: dict[str, _Accumulator] = defaultdict(_Accumulator)
    everything = _Accumulator()
    skipped: list[str] = []
    clean = 0

    for labeled in labels:
        if labeled.label != CLEAN:
            continue
        url = read_fixture_url(fixtures, labeled.fixture)
        html = (fixtures / f"{labeled.fixture}.html").read_text(encoding="utf-8")
        try:
            extraction = extract(html, url)
        except ExtractorError as error:
            skipped.append(f"{labeled.fixture}: extraction failed: {error}")
            continue
        if extraction.product is None:
            skipped.append(f"{labeled.fixture}: extraction found no product")
            continue
        histogram = build_rating_histogram(extraction.reviews)
        if histogram is None:
            skipped.append(f"{labeled.fixture}: no review carried a rating")
            continue
        clean += 1
        everything.histograms.append(histogram)
        everything.reviews += len(extraction.reviews)
        keys = category_keys(extraction.product.category)
        if not keys:
            skipped.append(f"{labeled.fixture}: the page states no category")
        for key in keys:
            held[key].histograms.append(histogram)
            held[key].reviews += len(extraction.reviews)

    estimates: list[CategoryEstimate] = []
    thin: list[Thin] = []
    for key in sorted(held):
        candidate = _estimate(key, held[key])
        if candidate.listing_count < min_listings:
            thin.append(Thin(key, f"{candidate.listing_count} listings, {min_listings} wanted"))
        elif candidate.review_count < min_reviews:
            thin.append(Thin(key, f"{candidate.review_count} reviews, {min_reviews} wanted"))
        else:
            estimates.append(candidate)

    overall = _estimate(DEFAULT_KEY, everything) if everything.histograms else None
    return PriorsFit(
        estimates=estimates,
        thin=thin,
        skipped=skipped,
        clean_listings=clean,
        default=overall,
    )


def priors_document(fit: PriorsFit, existing: dict[str, Any], *, replace_default: bool) -> dict:
    categories = {
        estimate.key: {"organicPrior": estimate.organic_prior} for estimate in fit.estimates
    }
    default = dict(existing["default"])
    if replace_default and fit.default is not None:
        default["organicPrior"] = fit.default.organic_prior
    default.setdefault("injectionKernel", list(DEFAULT_INJECTION_KERNEL))
    return {
        "note": existing["note"],
        "default": default,
        "aliases": existing.get("aliases", {}),
        "categories": categories,
    }


# an alias whose target lost its estimate would send a lookup nowhere
def dangling_aliases(document: dict) -> list[str]:
    categories = document.get("categories", {})
    return sorted(
        f"{name} points at {target}"
        for name, target in document.get("aliases", {}).items()
        if target not in categories
    )


def write_priors_document(path: Path, document: dict) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
