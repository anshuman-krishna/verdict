import { describe, expect, it } from "vitest";
import type { Report } from "../score/report";
import type { ReportOutcome } from "../score/buildReport";
import { badgeForOutcome } from "./badge";

function okOutcome(overrides: Partial<Report> = {}): ReportOutcome {
  return {
    status: "ok",
    featureVector: {} as never,
    report: {
      serial: "7QK2-M4P9",
      band: "mixed",
      claimedRating: 4.6,
      adjustedRating: 3.9,
      totalReviewCount: 120,
      excludedReviewCount: 30,
      estimatedInorganicShare: 0.25,
      confidence: { low: 0.18, high: 0.33 },
      evidence: [],
      unavailableSignals: [],
      generatedAt: 0,
      ...overrides,
    },
  };
}

describe("badgeForOutcome", () => {
  it("clears the badge when there is no outcome yet", () => {
    expect(badgeForOutcome(null)).toEqual({ text: "", color: "#00000000" });
  });

  it("clears the badge for every non ok status", () => {
    const statuses: ReportOutcome[] = [
      { status: "unreadable" },
      { status: "not-enough-data" },
      { status: "missing-features", missing: ["arrival timing"] },
      { status: "no-model" },
    ];
    for (const outcome of statuses) {
      expect(badgeForOutcome(outcome).text).toBe("");
    }
  });

  it("shows the estimated inorganic share as a percentage", () => {
    expect(badgeForOutcome(okOutcome({ estimatedInorganicShare: 0.37 })).text).toBe("37%");
  });

  it("rounds to the nearest whole percent", () => {
    expect(badgeForOutcome(okOutcome({ estimatedInorganicShare: 0.995 })).text).toBe("100%");
  });

  it("colors the badge to match the report's band", () => {
    const badge = badgeForOutcome(okOutcome({ band: "heavily-manipulated" }));
    expect(badge.color).toBe("#9C382F");
  });

  it("clamps an out of range share instead of producing a strange percentage", () => {
    expect(badgeForOutcome(okOutcome({ estimatedInorganicShare: 1.4 })).text).toBe("100%");
    expect(badgeForOutcome(okOutcome({ estimatedInorganicShare: -0.2 })).text).toBe("0%");
  });
});
