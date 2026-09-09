from dataclasses import dataclass

from verdict_research.corpus.dataset import LabeledExample
from verdict_research.eval.report import EvalReport, evaluate_model
from verdict_research.features.priors import placeholder_priors, priors_digest
from verdict_research.model.artifact import LOCAL_SLOT, SLOTS, ArtifactError, parse_model_artifact
from verdict_research.model.combine import CombinerModel, ModelSet
from verdict_research.model.pipeline import OperatingPoint, best_operating_point, report_problems


# scores the shipped model, never refits
@dataclass(frozen=True)
class Audit:
    slot: str
    model: CombinerModel
    report: EvalReport
    operating_point: OperatingPoint | None
    problems: list[str]
    corpus_priors: list[str]
    priors_match: bool


def _slot_model(models: ModelSet, slot: str) -> CombinerModel:
    if slot not in SLOTS:
        raise ArtifactError(f"unknown model slot {slot!r}")
    if slot == LOCAL_SLOT:
        return models.local
    if models.reviewer_graph is None:
        raise ArtifactError("model.json carries no reviewer graph model")
    return models.reviewer_graph


def audit_artifact(artifact: dict, examples: list[LabeledExample], slot: str = LOCAL_SLOT) -> Audit:
    models = parse_model_artifact(artifact)
    if models is None:
        raise ArtifactError("model.json states no model is present")
    if not examples:
        raise ArtifactError("the corpus holds no examples")

    model = _slot_model(models, slot)
    report = evaluate_model(model, examples)
    point = best_operating_point(report.curve)
    digests = sorted(
        {example.metadata["priors"] for example in examples if "priors" in example.metadata}
    )
    return Audit(
        slot=slot,
        model=model,
        report=report,
        operating_point=point,
        problems=report_problems(report, point),
        corpus_priors=digests,
        priors_match=not digests or digests == [priors_digest(placeholder_priors())],
    )
