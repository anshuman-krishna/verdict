import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { parseExpectation, type FixtureExpectation } from "../src/fixtures/expectation";

// the only part of the fixture machinery that touches the filesystem, kept
// out of src/ so nothing importable by an entrypoint can pull node:fs into
// a bundle.

export const FIXTURE_DIR = join(import.meta.dirname, "..", "fixtures");

export interface LoadedFixture {
  name: string;
  html: string;
  expectation: FixtureExpectation;
}

export class CorpusError extends Error {}

// an html with no json, or a json with no html, is an error rather than a
// skip: a half saved fixture that quietly disappeared from the run would
// make the pass rate in report.ts better, not worse.
export function loadCorpus(directory: string = FIXTURE_DIR): LoadedFixture[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }

  const pages = new Set<string>();
  const expectations = new Set<string>();
  for (const entry of entries) {
    const extension = extname(entry);
    if (extension === ".html") {
      pages.add(basename(entry, extension));
    } else if (extension === ".json") {
      expectations.add(basename(entry, extension));
    }
  }

  const orphanPages = [...pages].filter((name) => !expectations.has(name));
  const orphanExpectations = [...expectations].filter((name) => !pages.has(name));
  if (orphanPages.length > 0) {
    throw new CorpusError(`saved pages with no expectation file: ${orphanPages.sort().join(", ")}`);
  }
  if (orphanExpectations.length > 0) {
    throw new CorpusError(
      `expectation files with no saved page: ${orphanExpectations.sort().join(", ")}`,
    );
  }

  return [...pages].sort().map((name) => ({
    name,
    html: readFileSync(join(directory, `${name}.html`), "utf8"),
    expectation: parseExpectation(
      `${name}.json`,
      readFileSync(join(directory, `${name}.json`), "utf8"),
    ),
  }));
}
