// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { BUNDLED_AMAZON_RULES } from "../src/extract/bundledRules";
import { runFixture, type FixtureResult } from "../src/fixtures/harness";
import { buildCorpusReport, formatReport } from "../src/fixtures/report";
import { loadCorpus } from "./fixtureCorpus";

// PLAN.md week 1 task 6. Two modes, because "is extraction regressing" and "does version 0.1 meet
// SPEC.md section 14" are different questions with different right answers today. The per commit
// run fails only on a fixture that broke without anyone documenting why. The gated run, behind
// `just fixtures`, additionally holds the whole corpus to section 14 and fails when it is empty,
// since a corpus nobody has built yet has measured nothing and must never read as a pass.
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
