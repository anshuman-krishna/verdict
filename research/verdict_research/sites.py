import json
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

SITES_PATH = Path(__file__).resolve().parents[2] / "schema" / "sites.json"


@dataclass(frozen=True)
class ProductPage:
    site: str
    locale: str
    product_id: str


@cache
def read_sites(path: Path = SITES_PATH) -> tuple[dict[str, Any], ...]:
    return tuple(json.loads(path.read_text(encoding="utf-8"))["sites"])


# mirrors parseProductUrl in extension/src/extract/sites.ts
def product_page(url: str, sites: tuple[dict[str, Any], ...] | None = None) -> ProductPage | None:
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    for site in read_sites() if sites is None else sites:
        locale = next(
            (key for key, entry in site["locales"].items() if entry["host"] == parts.hostname),
            None,
        )
        if locale is None:
            continue
        match = re.search(site["productPath"], parts.path, re.IGNORECASE)
        if match is None:
            continue
        matched = match.group(1)
        product_id = matched if site.get("idCase") == "preserve" else matched.upper()
        if re.search(site["productId"], product_id) is None:
            continue
        return ProductPage(site=site["id"], locale=locale, product_id=product_id)
    return None
