import { describe, expect, it } from "vitest";
import { ANALYSIS_BUDGET_MS, formatVerdict, judge, measure, median } from "./budget";

describe("median", () => {
  it("takes the middle of an odd count", () => {
    expect(median([30, 10, 20])).toBe(20);
  });

  it("averages the two middles of an even count", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });
});

describe("judge", () => {
  it("rests the verdict on the median, not on one unlucky run", () => {
    const verdict = judge({ label: "a", durationsMs: [100, 110, 5000, 105, 100] });
    expect(verdict.medianMs).toBe(105);
    expect(verdict.worstMs).toBe(5000);
    expect(verdict.withinBudget).toBe(true);
  });

  it("reports the worst run even when the median passes", () => {
    expect(judge({ label: "a", durationsMs: [1, 9] }).worstMs).toBe(9);
  });

  it("fails when the median is over budget", () => {
    const verdict = judge({ label: "a", durationsMs: [2000, 2100, 2050] });
    expect(verdict.withinBudget).toBe(false);
    expect(verdict.headroomMs).toBeLessThan(0);
  });

  it("uses the section 14 budget by default", () => {
    expect(judge({ label: "a", durationsMs: [1] }).budgetMs).toBe(ANALYSIS_BUDGET_MS);
  });

  it("refuses to judge nothing", () => {
    expect(() => judge({ label: "a", durationsMs: [] })).toThrow(/nothing was measured/);
  });
});

describe("measure", () => {
  it("runs the body once per run and keeps the durations in order", () => {
    let calls = 0;
    const measurement = measure("a", 3, () => {
      calls += 1;
    });
    expect(calls).toBe(3);
    expect(measurement.durationsMs).toHaveLength(3);
    expect(measurement.label).toBe("a");
  });
});

describe("formatVerdict", () => {
  it("says by how much a passing run passed", () => {
    expect(formatVerdict(judge({ label: "full analysis", durationsMs: [500] }))).toBe(
      "full analysis: median 500ms, worst 500ms, within the 1500ms budget by 1000ms",
    );
  });

  it("says by how much a failing run failed", () => {
    expect(formatVerdict(judge({ label: "full analysis", durationsMs: [2000] }))).toContain(
      "over the 1500ms budget by 500ms",
    );
  });
});
