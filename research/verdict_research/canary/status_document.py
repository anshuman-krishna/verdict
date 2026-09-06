import json
from pathlib import Path

from verdict_research.canary.check import CanarySummary

# SITE.md's /status page: "a register table. One row per site and locale:
# last verified, extraction health, rules version, median reviews extracted.
# Updated by the Python canary job." This is the handover between the two,
# a plain JSON document the Astro page reads at build time.
#
# Static on purpose. SITE.md's build notes rule out any third party script
# and want every page working with JavaScript disabled, so /status cannot
# fetch this at view time: the canary job writes the file, the site is
# rebuilt, and the page is still a static page. That also means an empty
# document is a normal state, not an error, and the page has to render it.

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


# writes with a trailing newline and sorted keys so a run that changed
# nothing produces no diff, which is what makes it safe to commit the site's
# copy of this file.
def write_status_document_file(document: dict, path: str | Path) -> None:
    Path(path).write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")


# the empty document the site ships with before the canary has ever run.
def empty_status_document() -> dict:
    return build_status_document([], generated_at=0.0)
