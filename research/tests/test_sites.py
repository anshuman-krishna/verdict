import json
from pathlib import Path

from verdict_research.sites import read_sites


# what each url reads as is pinned in tests/parity/productUrls.json
def test_reads_the_registry_the_extension_reads():
    registry = Path(__file__).resolve().parents[2] / "schema" / "sites.json"
    ids = [site["id"] for site in json.loads(registry.read_text(encoding="utf-8"))["sites"]]
    assert [site["id"] for site in read_sites()] == ids
