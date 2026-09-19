from dataclasses import dataclass, field
from typing import Any

# the shape extension/src/score/reportDocument.ts writes. version 1 carried the report alone,
# which cannot be run again, so a version 1 document is readable and not reproducible
DOCUMENT_VERSION = 2

FEATURES_FROM_VERSION = 2


class DocumentError(ValueError):
    pass


@dataclass(frozen=True)
class ReportDocument:
    document_version: int
    exported_at: float | None
    title: str
    serial: str
    band: str | None
    probability: float | None
    claimed_rating: float | None
    adjusted_rating: float | None
    total_review_count: int | None
    excluded_review_count: int | None
    features: dict[str, float | None]
    unavailable_signals: list[str]
    absent_signals: list[str]
    provenance: dict[str, Any] | None = None
    evidence: list[dict[str, Any]] = field(default_factory=list)

    @property
    def reproducible(self) -> bool:
        return bool(self.features) and self.probability is not None


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def _strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _features(value: Any) -> dict[str, float | None]:
    if not isinstance(value, dict):
        return {}
    read: dict[str, float | None] = {}
    for key, entry in value.items():
        if not isinstance(key, str):
            continue
        read[key] = None if entry is None else _number(entry)
    return read


def parse_report_document(data: Any) -> ReportDocument:
    if not isinstance(data, dict):
        raise DocumentError("this is not a report document, it is not even a json object")
    version = data.get("documentVersion")
    if not isinstance(version, int):
        raise DocumentError("the document names no version, so nothing can be assumed about it")
    if version > DOCUMENT_VERSION:
        raise DocumentError(
            f"document version {version} was written by a newer build than this checkout, "
            f"which reads up to version {DOCUMENT_VERSION}"
        )
    report = data.get("report")
    if not isinstance(report, dict):
        raise DocumentError("the document carries no report")

    band = report.get("band")
    provenance = report.get("provenance")
    evidence = report.get("evidence")
    return ReportDocument(
        document_version=version,
        exported_at=_number(data.get("exportedAt")),
        title=data.get("title") if isinstance(data.get("title"), str) else "",
        serial=report.get("serial") if isinstance(report.get("serial"), str) else "",
        band=band if isinstance(band, str) else None,
        probability=_number(report.get("probability")),
        claimed_rating=_number(report.get("claimedRating")),
        adjusted_rating=_number(report.get("adjustedRating")),
        total_review_count=_count(report.get("totalReviewCount")),
        excluded_review_count=_count(report.get("excludedReviewCount")),
        features=_features(data.get("features")),
        unavailable_signals=_strings(report.get("unavailableSignals")),
        absent_signals=_strings(report.get("absentSignals")),
        provenance=provenance if isinstance(provenance, dict) else None,
        evidence=[row for row in evidence if isinstance(row, dict)]
        if isinstance(evidence, list)
        else [],
    )


def _count(value: Any) -> int | None:
    number = _number(value)
    return None if number is None else int(number)


def unreproducible_reason(document: ReportDocument) -> str | None:
    if document.document_version < FEATURES_FROM_VERSION:
        return (
            f"this is a version {document.document_version} document, written before exports "
            "carried the numbers the model was given, so the reading cannot be run again"
        )
    if not document.features:
        return (
            "the document carries no features, which happens when the check was saved before "
            "this build recorded them"
        )
    if document.probability is None:
        return "the report records no probability, so there is nothing to compare a rerun against"
    return None
