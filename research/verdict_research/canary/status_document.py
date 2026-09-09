import json
from pathlib import Path

from verdict_research.canary.check import CanarySummary

STATUS_DOCUMENT_VERSION = 1


def build_status_document(summaries: list[CanarySummary], generated_at: float) -> dict:
    return {
        "documentVersion": STATUS_DOCUMENT_VERSION,
        "generatedAt": generated_at,
        "rows": [
            {
                "site": summary.site,
                "locale": summary.locale,
                "lastVerified": summary.last_verified,
                "status": summary.status,
                "rulesVersion": summary.rules_version,
                "medianReviewsExtracted": summary.median_reviews_extracted,
            }
            for summary in summaries
        ],
    }


def read_status_document(path: str | Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_status_document_file(document: dict, path: str | Path) -> None:
    Path(path).write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def empty_status_document() -> dict:
    return build_status_document([], generated_at=0.0)
