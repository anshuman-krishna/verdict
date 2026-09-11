// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Report } from "../score/report";
import type { HistoryEntry } from "../storage/history";
import {
  earlierChecksMarkup,
  intervalLine,
  renderReportDetail,
  rescoredLine,
  unavailableLine,
} from "./reportDetail";

function report(overrides: Partial<Report> = {}): Report {
  return {
    serial: "7QK2-M4P9",
    band: "mixed",
    claimedRating: 4.6,
    adjustedRating: 3.9,
    totalReviewCount: 120,
    excludedReviewCount: 30,
    estimatedInorganicShare: 0.25,
    confidence: { low: 0.18, high: 0.33 },
    evidence: [
      {
        signal: "arrival timing",
        strength: "moderate",
        detail: "2 unusual arrival bursts, covering about 12 percent of reviews.",
        value: 0.12,
      },
    ],
    unavailableSignals: [],
    generatedAt: Date.parse("2026-01-15T12:00:00Z"),
    ...overrides,
  };
}

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 1,
    timestamp: Date.parse("2026-01-15T12:00:00Z"),
    title: "a product",
    thumbnailUrl: null,
    report: report(),
    ...overrides,
  };
}

function render(over: Partial<HistoryEntry> = {}, rescored = null): HTMLElement {
  const container = document.createElement("div");
  renderReportDetail(container, entry(over), rescored, { onBack: vi.fn() });
  return container;
}

describe("renderReportDetail", () => {
  it("shows the band, both ratings, and how many reviews were excluded", () => {
    const container = render();
    expect(container.querySelector(".detail-band")?.textContent).toBe("mixed");
    expect(container.querySelectorAll(".figures dd")[0]?.textContent).toBe("3.9");
    expect(container.querySelectorAll(".figures dd")[1]?.textContent).toBe("4.6");
    expect(container.querySelector(".strip-labels")?.textContent).toContain("excluded 30");
  });

  it("lists every evidence row, with its detail hidden until asked for", () => {
    const container = render();
    expect(container.querySelectorAll(".row").length).toBe(1);
    const detail = container.querySelector<HTMLElement>(".detail-text");
    expect(detail?.hidden).toBe(true);

    container.querySelector<HTMLButtonElement>(".row-toggle")?.click();

    expect(detail?.hidden).toBe(false);
    expect(container.querySelector(".row-toggle")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes an evidence row that was already open", () => {
    const container = render();
    const toggle = container.querySelector<HTMLButtonElement>(".row-toggle");
    toggle?.click();
    toggle?.click();
    expect(container.querySelector<HTMLElement>(".detail-text")?.hidden).toBe(true);
  });

  it("goes back to the list when asked", () => {
    const onBack = vi.fn();
    const container = document.createElement("div");
    renderReportDetail(container, entry(), null, { onBack });
    container.querySelector<HTMLButtonElement>(".back")?.click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("escapes a title and an evidence detail, since a seller writes the words they quote", () => {
    const container = render({
      title: `<img src=x onerror=alert(1)>`,
      report: report({
        evidence: [
          {
            signal: "duplicate text",
            strength: "weak",
            detail: `<img src=x onerror=alert(1)>`,
            value: 0,
          },
        ],
      }),
    });

    expect(container.querySelectorAll("img").length).toBe(0);
    expect(container.querySelector(".detail-title")?.textContent).toBe(`<img src=x onerror=alert(1)>`);
  });

  it("says so plainly when an older build stored something it cannot read", () => {
    const container = render({ report: { band: "mixed" } });
    expect(container.querySelector(".empty")?.textContent).toContain("older version");
    expect(container.querySelector(".figures")).toBeNull();
  });

  it("shows the serial the panel quoted", () => {
    expect(render().querySelector(".serial")?.textContent).toBe("7QK2-M4P9");
  });
});

describe("the lines the detail view puts under the figures", () => {
  it("states the interval as a range of reviews", () => {
    expect(intervalLine(report())).toBe("Estimated between 18 and 33 percent of reviews.");
  });

  it("states a single figure when the interval rounds to one", () => {
    expect(intervalLine(report({ confidence: { low: 0.25, high: 0.252 } }))).toBe(
      "Estimated 25 percent of reviews.",
    );
  });

  it("says nothing about unavailable signals when every one was read", () => {
    expect(unavailableLine(report())).toBeNull();
  });

  it("names one signal that could not be read", () => {
    expect(unavailableLine(report({ unavailableSignals: ["reviewer network"] }))).toBe(
      "reviewer network could not be read on this page, which widens the estimate.",
    );
  });

  it("joins several of them the way the panel does", () => {
    expect(
      unavailableLine(report({ unavailableSignals: ["rating shape", "arrival timing", "duplicate text"] })),
    ).toBe(
      "rating shape, arrival timing and duplicate text could not be read on this page, which widens the estimate.",
    );
  });

  it("says nothing when the current model reads the same band", () => {
    const rescored = { band: "mixed" as const, probability: 0.5, unavailableSignals: [] };
    expect(rescoredLine(report(), rescored)).toBeNull();
  });

  it("says what the current model reads when it differs from the stored band", () => {
    const rescored = { band: "doubtful" as const, probability: 0.7, unavailableSignals: [] };
    expect(rescoredLine(report(), rescored)).toBe(
      "Scored again with the current model, this reads as doubtful.",
    );
  });

  it("says nothing when there is no model to score against", () => {
    expect(rescoredLine(report(), null)).toBeNull();
  });
});

describe("the earlier checks of the same listing", () => {
  const checks = [
    { timestamp: Date.parse("2026-01-02T12:00:00Z"), band: "clean" as const, adjustedRating: 4.4 },
    { timestamp: Date.parse("2025-12-01T12:00:00Z"), band: null, adjustedRating: null },
  ];

  it("lists each one with its date and what it read", () => {
    const container = document.createElement("div");
    renderReportDetail(container, entry(), null, { onBack: vi.fn() }, checks);

    const rows = container.querySelectorAll(".earlier-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("clean");
    expect(rows[0]?.textContent).toContain("4.4");
  });

  it("leaves the band and rating blank for a check it cannot read", () => {
    const container = document.createElement("div");
    renderReportDetail(container, entry(), null, { onBack: vi.fn() }, checks);
    expect(container.querySelectorAll(".earlier-row")[1]?.textContent).not.toContain("clean");
  });

  it("shows no heading at all for a listing checked only once", () => {
    expect(earlierChecksMarkup([])).toBe("");
    const container = render();
    expect(container.querySelector(".earlier")).toBeNull();
  });
});
