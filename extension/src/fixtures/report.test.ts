import { describe, expect, it } from "vitest";
import type { FixtureResult } from "./harness";
import { buildCorpusReport, formatReport } from "./report";

function result(overrides: Partial<FixtureResult> = {}): FixtureResult {
  return {
    name: "a",
    site: "amazon",
    locale: "com",
    layout: "modern",
    ok: true,
    knownFailure: null,
    extractedReviews: 30,
    checks: [],
    ...overrides,
  };
}

function passing(locale: string, count: number): FixtureResult[] {
  return Array.from({ length: count }, (_unused, index) =>
    result({ name: `${locale}-${index}`, locale }),
  );
}

const FOUR_LOCALES = [
  ...passing("com", 10),
  ...passing("fr", 10),
  ...passing("de", 10),
  ...passing("co.uk", 10),
];

describe("buildCorpusReport", () => {
  it("reports an empty corpus as unmeasured, not as zero", () => {
    const report = buildCorpusReport([]);
    expect(report.passRate).toBeNull();
    expect(report.meetsCriterion).toBe(false);
    expect(formatReport(report)).toContain("unmeasured");
  });

  it("meets the criterion at 38 of 40 across four locales", () => {
    const results = [...FOUR_LOCALES];
    results[0] = result({ ...results[0], ok: false } as FixtureResult);
    results[1] = result({ ...results[1], ok: false } as FixtureResult);
    const report = buildCorpusReport(results);
    expect(report.passed).toBe(38);
    expect(report.passRate).toBeCloseTo(0.95, 10);
    expect(report.meetsPassRate).toBe(true);
    expect(report.meetsLocaleCoverage).toBe(true);
    expect(report.meetsCriterion).toBe(true);
  });

  it("misses the criterion at 37 of 40", () => {
    const results = [...FOUR_LOCALES];
    for (let index = 0; index < 3; index += 1) {
      results[index] = result({ ...results[index], ok: false } as FixtureResult);
    }
    expect(buildCorpusReport(results).meetsPassRate).toBe(false);
  });

  it("misses the criterion on three locales however well they pass", () => {
    const report = buildCorpusReport([
      ...passing("com", 10),
      ...passing("fr", 10),
      ...passing("de", 10),
    ]);
    expect(report.meetsPassRate).toBe(true);
    expect(report.meetsLocaleCoverage).toBe(false);
    expect(report.meetsCriterion).toBe(false);
  });

  // a documented failure still counts against the pass rate, so nobody can
  // reach the section 14 number by writing reasons.
  it("keeps a documented failure in the pass rate but out of the undocumented list", () => {
    const results = [
      ...passing("com", 9),
      result({ name: "known", locale: "com", ok: false, knownFailure: "legacy pagination" }),
    ];
    const report = buildCorpusReport(results);
    expect(report.passed).toBe(9);
    expect(report.failures).toHaveLength(1);
    expect(report.unexpectedFailures).toEqual([]);
  });

  it("lists an undocumented failure separately", () => {
    const report = buildCorpusReport([...passing("com", 9), result({ name: "broke", ok: false })]);
    expect(report.unexpectedFailures.map((entry) => entry.name)).toEqual(["broke"]);
  });

  it("tallies each locale", () => {
    const report = buildCorpusReport([
      ...passing("com", 2),
      result({ name: "fr-bad", locale: "fr", ok: false }),
    ]);
    expect(report.locales).toEqual([
      { locale: "com", total: 2, passed: 2 },
      { locale: "fr", total: 1, passed: 0 },
    ]);
  });
});

describe("formatReport", () => {
  it("names the field and the strategy that ran on a failure", () => {
    const report = buildCorpusReport([
      result({
        name: "b0abcdef12",
        ok: false,
        checks: [
          {
            field: "claimedRating",
            expected: 4.6,
            actual: null,
            ok: false,
            strategies: [{ strategy: "selector", depth: 0, target: ".rating", matched: 0 }],
          },
        ],
      }),
    ]);
    const text = formatReport(report);
    expect(text).toContain("b0abcdef12");
    expect(text).toContain("claimedRating: expected 4.6, got null");
    expect(text).toContain('selector ".rating" matched 0');
  });

  it("says a missing rule is a missing rule, not a broken page", () => {
    const report = buildCorpusReport([
      result({
        ok: false,
        checks: [
          { field: "claimedRating", expected: 4.6, actual: null, ok: false, strategies: [] },
        ],
      }),
    ]);
    expect(formatReport(report)).toContain("no rule for this field in rules.json");
  });

  it("marks a documented failure as known", () => {
    const report = buildCorpusReport([
      result({ name: "known", ok: false, knownFailure: "legacy pagination" }),
    ]);
    expect(formatReport(report)).toContain("[known: legacy pagination]");
  });
});
