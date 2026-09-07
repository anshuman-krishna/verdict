import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExpectationError } from "../src/fixtures/expectation";
import { CorpusError, loadCorpus } from "./fixtureCorpus";

// synthetic directories, never the real corpus in extension/fixtures.

function corpusDir(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "verdict-corpus-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(directory, name), content);
  }
  return directory;
}

const EXPECTATION = JSON.stringify({
  url: "https://www.amazon.com/dp/B0ABCDEF12",
  layout: "modern",
  reviewCount: 12,
  claimedRating: 4.6,
});

describe("loadCorpus", () => {
  it("pairs each saved page with its expectation, sorted by name", () => {
    const directory = corpusDir({
      "b.html": "<html></html>",
      "b.json": EXPECTATION,
      "a.html": "<html></html>",
      "a.json": EXPECTATION,
    });
    expect(loadCorpus(directory).map((fixture) => fixture.name)).toEqual(["a", "b"]);
  });

  it("refuses a saved page with no expectation file", () => {
    const directory = corpusDir({ "a.html": "<html></html>" });
    expect(() => loadCorpus(directory)).toThrow(CorpusError);
  });

  it("refuses an expectation file with no saved page", () => {
    const directory = corpusDir({ "a.json": EXPECTATION });
    expect(() => loadCorpus(directory)).toThrow(CorpusError);
  });

  it("lets a malformed expectation fail the run rather than dropping the fixture", () => {
    const directory = corpusDir({ "a.html": "<html></html>", "a.json": "{" });
    expect(() => loadCorpus(directory)).toThrow(ExpectationError);
  });

  it("ignores files that are neither, so a readme can live beside the corpus", () => {
    const directory = corpusDir({
      "README.md": "# corpus",
      "a.html": "<html></html>",
      "a.json": EXPECTATION,
    });
    expect(loadCorpus(directory)).toHaveLength(1);
  });

  it("reads an absent directory as an empty corpus", () => {
    expect(loadCorpus(join(tmpdir(), "verdict-corpus-does-not-exist"))).toEqual([]);
  });
});
