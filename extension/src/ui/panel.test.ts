// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { Report } from "../score/report";
import { getPanelShadowRootForTesting, VerdictPanelElement } from "./panel";
import type { RosetteInput } from "./rosette";

function sampleReport(overrides: Partial<Report> = {}): Report {
  return {
    serial: "7F2A-0091",
    band: "mixed",
    claimedRating: 4.6,
    adjustedRating: 3.9,
    totalReviewCount: 8431,
    excludedReviewCount: 1208,
    estimatedInorganicShare: 0.143,
    confidence: { low: 0.1, high: 0.19 },
    evidence: [
      { signal: "rating shape", strength: "strong", detail: "the rating histogram does not look organic", value: 0.4 },
      { signal: "arrival timing", strength: "moderate", detail: "reviews arrived in unusual bursts", value: 0.2 },
    ],
    generatedAt: Date.now(),
    ...overrides,
  };
}

const rosetteInput: RosetteInput = {
  burstShare: 0.3,
  duplicateShare: 0.1,
  estimatedInorganicShare: 0.143,
  band: "mixed",
};

function stubMatchMedia(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  stubMatchMedia(false);
});

describe("VerdictPanelElement", () => {
  it("renders the band, figures, counts, and summary sentence from the report", () => {
    const panel = new VerdictPanelElement();
    panel.render(sampleReport(), rosetteInput);
    const root = getPanelShadowRootForTesting(panel);

    expect(root.querySelector(".adjusted")?.textContent).toBe("3.9");
    expect(root.querySelector(".claimed")?.textContent).toBe("4.6");
    expect(root.querySelector(".summary")?.textContent).toContain("mixed");
    expect(root.querySelector(".summary")?.textContent).toContain("1,208");
    expect(root.querySelector(".summary")?.textContent).toContain("8,431");
  });

  it("gives the rosette a text alternative naming the band and the share", () => {
    const panel = new VerdictPanelElement();
    panel.render(sampleReport(), rosetteInput);
    const root = getPanelShadowRootForTesting(panel);

    const title = root.querySelector("title");
    expect(title?.textContent).toContain("mixed");
    expect(title?.textContent).toContain("14 percent");
  });

  it("renders the kept and excluded counts on the specimen strip", () => {
    const panel = new VerdictPanelElement();
    panel.render(sampleReport(), rosetteInput);
    const root = getPanelShadowRootForTesting(panel);

    expect(root.querySelector(".specimen-labels")?.textContent).toContain("kept 7,223");
    expect(root.querySelector(".specimen-labels")?.textContent).toContain("excluded 1,208");
  });

  it("expands an evidence row on click and reveals its detail sentence", () => {
    const panel = new VerdictPanelElement();
    panel.render(sampleReport(), rosetteInput);
    const root = getPanelShadowRootForTesting(panel);

    const toggle = root.querySelector<HTMLButtonElement>(".row-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    toggle?.click();

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    const detailId = toggle?.getAttribute("aria-controls");
    const detail = detailId !== null && detailId !== undefined ? root.getElementById(detailId) : null;
    expect(detail?.hidden).toBe(false);
    expect(detail?.textContent).toContain("does not look organic");
  });

  it("dispatches verdict:close when the close button is clicked", () => {
    const panel = new VerdictPanelElement();
    document.body.appendChild(panel);
    panel.render(sampleReport(), rosetteInput);
    const root = getPanelShadowRootForTesting(panel);

    let closed = false;
    panel.addEventListener("verdict:close", () => {
      closed = true;
    });
    root.querySelector<HTMLButtonElement>(".close")?.click();

    expect(closed).toBe(true);
    document.body.removeChild(panel);
  });

  it("dispatches verdict:full-report when the full report button is clicked", () => {
    const panel = new VerdictPanelElement();
    document.body.appendChild(panel);
    panel.render(sampleReport(), rosetteInput);
    const root = getPanelShadowRootForTesting(panel);

    let dispatched = false;
    panel.addEventListener("verdict:full-report", () => {
      dispatched = true;
    });
    root.querySelector<HTMLButtonElement>(".full-report")?.click();

    expect(dispatched).toBe(true);
    document.body.removeChild(panel);
  });

  it("dispatches verdict:close on escape", () => {
    const panel = new VerdictPanelElement();
    document.body.appendChild(panel);
    panel.render(sampleReport(), rosetteInput);

    let closed = false;
    panel.addEventListener("verdict:close", () => {
      closed = true;
    });
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(closed).toBe(true);
    document.body.removeChild(panel);
  });

  it("marks the rosette path as no-motion when prefers-reduced-motion is set", () => {
    stubMatchMedia(true);
    const panel = new VerdictPanelElement();
    panel.render(sampleReport(), rosetteInput);
    const root = getPanelShadowRootForTesting(panel);

    expect(root.querySelector(".rosette-path")?.classList.contains("no-motion")).toBe(true);
  });

  it("shows 'checked just now' immediately after generation", () => {
    const panel = new VerdictPanelElement();
    const generatedAt = 1_700_000_000_000;
    panel.render(sampleReport({ generatedAt }), rosetteInput, generatedAt + 5_000);
    const root = getPanelShadowRootForTesting(panel);

    expect(root.querySelector(".checked")?.textContent).toBe("checked just now");
  });

  it("shows a minutes-ago phrasing once enough time has passed", () => {
    const panel = new VerdictPanelElement();
    const generatedAt = 1_700_000_000_000;
    panel.render(sampleReport({ generatedAt }), rosetteInput, generatedAt + 5 * 60_000);
    const root = getPanelShadowRootForTesting(panel);

    expect(root.querySelector(".checked")?.textContent).toBe("checked 5 minutes ago");
  });
});
