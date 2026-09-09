import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from verdict_research.corpus.dataset import LabeledExample
from verdict_research.features.feature_vector import FeatureVectorInputs, build_feature_vector
from verdict_research.features.priors import priors_digest
from verdict_research.model.combine import flatten_feature_vector
from verdict_research.schema import ProductSnapshot
from verdict_research.shipped_extractor import ExtractorError, FullExtraction

Extract = Callable[[str, str], FullExtraction]

VALID_LABELS = (0, 1)


class LabelFileError(ValueError):
    pass


@dataclass(frozen=True)
class LabeledFixture:
    fixture: str
    label: int
    source: str | None = None
    notes: str | None = None


@dataclass(frozen=True)
class Skipped:
    fixture: str
    reason: str


@dataclass(frozen=True)
class FeaturisationRun:
    examples: list[LabeledExample] = field(default_factory=list)
    skipped: list[Skipped] = field(default_factory=list)


def read_label_file(path: Path) -> list[LabeledFixture]:
    labels: list[LabeledFixture] = []
    seen: set[str] = set()
    with open(path, encoding="utf-8") as handle:
        for number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError as error:
                raise LabelFileError(f"{path}:{number} is not json: {error}") from error
            fixture = data.get("fixture")
            label = data.get("label")
            if not isinstance(fixture, str) or not fixture:
                raise LabelFileError(f"{path}:{number} has no fixture name")
            if label not in VALID_LABELS:
                raise LabelFileError(f"{path}:{number} labels {fixture} {label!r}, expected 0 or 1")
            if fixture in seen:
                raise LabelFileError(f"{path}:{number} labels {fixture} a second time")
            seen.add(fixture)
            labels.append(
                LabeledFixture(
                    fixture=fixture,
                    label=label,
                    source=data.get("source"),
                    notes=data.get("notes"),
                )
            )
    return labels


def read_fixture_url(fixtures: Path, fixture: str) -> str:
    page = fixtures / f"{fixture}.html"
    expectation = fixtures / f"{fixture}.json"
    if not page.exists():
        raise LabelFileError(f"{page} does not exist")
    if not expectation.exists():
        raise LabelFileError(f"{expectation} does not exist")
    with open(expectation, encoding="utf-8") as handle:
        data = json.load(handle)
    url = data.get("url")
    if not isinstance(url, str) or not url:
        raise LabelFileError(f"{expectation} has no url")
    return url


def example_id_for(fixture: str) -> str:
    return hashlib.sha256(fixture.encode("utf-8")).hexdigest()[:16]


def product_text(product: ProductSnapshot) -> str:
    if product.category is None:
        return product.title
    return f"{product.title} {product.category}"


def featurise_extraction(
    extraction: FullExtraction,
    labeled: LabeledFixture,
    priors: FeatureVectorInputs,
) -> LabeledExample | Skipped:
    if extraction.product is None:
        return Skipped(labeled.fixture, "extraction found no product")
    inputs = FeatureVectorInputs(
        organic_prior=list(priors.organic_prior),
        injection_kernel=list(priors.injection_kernel),
        window_days=priors.window_days,
        percentile=priors.percentile,
        product_text=product_text(extraction.product),
    )
    vector = build_feature_vector(extraction.reviews, inputs)
    if not vector.meets_minimum_data:
        return Skipped(labeled.fixture, "below the minimum data thresholds")

    metadata = {
        "site": extraction.site or "",
        "locale": extraction.locale or "",
        "extractedReviewCount": str(extraction.review_count),
        "rulesVersion": str(extraction.rules_version),
        "priors": priors_digest(inputs),
    }
    if labeled.source is not None:
        metadata["source"] = labeled.source
    return LabeledExample(
        example_id=example_id_for(labeled.fixture),
        features=flatten_feature_vector(vector),
        label=labeled.label,
        metadata=metadata,
    )


def featurise(
    labels: list[LabeledFixture],
    fixtures: Path,
    extract: Extract,
    priors: FeatureVectorInputs,
) -> FeaturisationRun:
    run = FeaturisationRun()
    for labeled in labels:
        url = read_fixture_url(fixtures, labeled.fixture)
        html = (fixtures / f"{labeled.fixture}.html").read_text(encoding="utf-8")
        try:
            extraction = extract(html, url)
        except ExtractorError as error:
            run.skipped.append(Skipped(labeled.fixture, f"extraction failed: {error}"))
            continue
        result = featurise_extraction(extraction, labeled, priors)
        if isinstance(result, Skipped):
            run.skipped.append(result)
        else:
            run.examples.append(result)
    return run
