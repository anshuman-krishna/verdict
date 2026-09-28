import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseProductUrl } from "../src/extract/sites";

// research/verdict_research/sites.py reads the same file, and the canary refuses targets by it
const CASES_PATH = fileURLToPath(new URL("../../tests/parity/productUrls.json", import.meta.url));

interface ProductUrlCase {
  url: string;
  page: { site: string; locale: string; productId: string } | null;
}

const cases = JSON.parse(readFileSync(CASES_PATH, "utf8")) as ProductUrlCase[];

describe("product urls, read the way the python side reads them", () => {
  it.each(cases)("$url", ({ url, page }) => {
    expect(parseProductUrl(url)).toEqual(page);
  });
});
