import hashlib
import json
from pathlib import Path

from verdict_research.features.feature_vector import FeatureVectorInputs

_PRIORS_PATH = Path(__file__).parents[3] / "schema" / "priors.json"

with open(_PRIORS_PATH, encoding="utf-8") as _handle:
    _PRIORS = json.load(_handle)

PLACEHOLDER_ORGANIC_PRIOR: list[float] = [float(value) for value in _PRIORS["organicPrior"]]
PLACEHOLDER_INJECTION_KERNEL: list[float] = [float(value) for value in _PRIORS["injectionKernel"]]


def placeholder_priors(product_text: str = "") -> FeatureVectorInputs:
    return FeatureVectorInputs(
        organic_prior=list(PLACEHOLDER_ORGANIC_PRIOR),
        injection_kernel=list(PLACEHOLDER_INJECTION_KERNEL),
        product_text=product_text,
    )


def priors_digest(inputs: FeatureVectorInputs) -> str:
    canonical = json.dumps(
        {"organicPrior": inputs.organic_prior, "injectionKernel": inputs.injection_kernel},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:8]
