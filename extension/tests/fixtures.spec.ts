// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { BUNDLED_AMAZON_RULES } from "../src/extract/bundledRules";
import { runFixture, type FixtureResult } from "../src/fixtures/harness";
import { buildCorpusReport, formatReport } from "../src/fixtures/report";
import { loadCorpus } from "./fixtureCorpus";

const GATED = process.env.VERDICT_FIXTURE_GATE === "1";

describe("fixture corpus", () => {
  const fixtures = loadCorpus();
  const results: FixtureResult[] = fixtures.map((fixture) =>
    runFixture(
      fixture.name,
      new DOMParser().parseFromString(fixture.html, "text/html"),
      fixture.expectation,
      BUNDLED_AMAZON_RULES,
    ),
  );
  const report = buildCorpusReport(results);

  it("reports every fixture it loaded", () => {
    console.log(formatReport(report));
    expect(report.total).toBe(fixtures.length);
  });

  it("has no undocumented failures", () => {
    expect(report.unexpectedFailures.map((failure) => failure.name)).toEqual([]);
  });

  it.runIf(GATED)("meets the section 14 extraction criterion", () => {
    expect(report.total).toBeGreaterThan(0);
    expect(report.meetsPassRate).toBe(true);
    expect(report.meetsLocaleCoverage).toBe(true);
  });
});
