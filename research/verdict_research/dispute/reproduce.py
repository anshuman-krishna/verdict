from dataclasses import dataclass
from typing import Any

from verdict_research.dispute.document import ReportDocument, unreproducible_reason
from verdict_research.model.artifact import (
    LOCAL_SLOT,
    REVIEWER_GRAPH_SLOT,
    ArtifactError,
    parse_model_artifact,
)
from verdict_research.model.combine import (
    MEDIAN_FRACTION,
    CombinerModel,
    CombinerOk,
    ModelSet,
    quantile_value,
    score_features,
)

# SPEC.md section 7 holds the two scorers to 1e-6, so a rerun that agrees to less than that
# is telling us about the model, not about floating point
TOLERANCE = 1e-6

GRAPH_FEATURE = "reviewerGraph.flaggedReviewShare"


@dataclass(frozen=True)
class Contribution:
    key: str
    value: float
    coefficient: float
    contribution: float
    # filled from the model's own quantile sketch, because the page did not carry it
    imputed: bool


@dataclass(frozen=True)
class Reproduction:
    slot: str
    claimed_probability: float | None
    probability: float | None
    difference: float | None
    intercept: float
    contributions: list[Contribution]
    problems: list[str]

    @property
    def agrees(self) -> bool:
        return self.difference is not None and abs(self.difference) <= TOLERANCE


def _slot_for(models: ModelSet, features: dict[str, float | None]) -> str:
    share = features.get(GRAPH_FEATURE)
    if models.reviewer_graph is not None and share is not None:
        return REVIEWER_GRAPH_SLOT
    return LOCAL_SLOT


def _model_in(models: ModelSet, slot: str) -> CombinerModel:
    if slot == REVIEWER_GRAPH_SLOT and models.reviewer_graph is not None:
        return models.reviewer_graph
    return models.local


def _contributions(model: CombinerModel, features: dict[str, float | None]) -> list[Contribution]:
    built: list[Contribution] = []
    for key, coefficient in model.coefficients.items():
        present = features.get(key)
        imputed = present is None
        sketch = model.feature_quantiles.get(key, [])
        if imputed and not sketch:
            continue
        value = quantile_value(sketch, MEDIAN_FRACTION) if imputed else float(present)
        built.append(
            Contribution(
                key=key,
                value=value,
                coefficient=coefficient,
                contribution=coefficient * value,
                imputed=imputed,
            )
        )
    # largest mover first, since that is the line a dispute is actually about
    built.sort(key=lambda row: abs(row.contribution), reverse=True)
    return built


def reproduce(document: ReportDocument, artifact: Any) -> Reproduction:
    blocked = unreproducible_reason(document)
    models = parse_model_artifact(artifact)
    if models is None:
        raise ArtifactError(
            "model.json states no model is present, so there is nothing to rerun this against"
        )

    slot = _slot_for(models, document.features)
    model = _model_in(models, slot)
    contributions = _contributions(model, document.features)

    if blocked is not None:
        return Reproduction(
            slot=slot,
            claimed_probability=document.probability,
            probability=None,
            difference=None,
            intercept=model.intercept,
            contributions=contributions,
            problems=[blocked],
        )

    result = score_features(model, dict(document.features), impute=MEDIAN_FRACTION)
    if not isinstance(result, CombinerOk):
        return Reproduction(
            slot=slot,
            claimed_probability=document.probability,
            probability=None,
            difference=None,
            intercept=model.intercept,
            contributions=contributions,
            problems=[_result_problem(result)],
        )

    claimed = document.probability
    difference = None if claimed is None else result.probability - claimed
    problems: list[str] = []
    if difference is not None and abs(difference) > TOLERANCE:
        problems.append(
            f"the model in this checkout reads {result.probability:.6f} where the report "
            f"recorded {claimed:.6f}. Either the model changed since the check, or the "
            "document did"
        )
    return Reproduction(
        slot=slot,
        claimed_probability=claimed,
        probability=result.probability,
        difference=difference,
        intercept=model.intercept,
        contributions=contributions,
        problems=problems,
    )


def _result_problem(result: Any) -> str:
    if getattr(result, "status", "") == "missing-features":
        named = ", ".join(result.missing)
        return f"the model needs {named}, which the document does not carry and cannot fill"
    return "the features in this document are all imputed, so the model returns only its prior"
