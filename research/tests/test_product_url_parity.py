import json
from pathlib import Path

import pytest

from verdict_research.sites import ProductPage, product_page

# extension/tests/productUrlParity.spec.ts reads the same file
CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "tests" / "parity" / "productUrls.json").read_text(
        encoding="utf-8"
    )
)


@pytest.mark.parametrize("case", CASES, ids=[case["url"] for case in CASES])
def test_reads_a_product_url_the_way_the_extension_does(case):
    expected = case["page"]
    page = product_page(case["url"])
    if expected is None:
        assert page is None
    else:
        assert page == ProductPage(
            site=expected["site"], locale=expected["locale"], product_id=expected["productId"]
        )
