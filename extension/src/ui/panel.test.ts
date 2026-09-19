// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { newTranslator } from "../i18n/translator";
import type { Report } from "../score/report";
import {
  getPanelShadowRootForTesting,
  previouslyLine,
  VerdictPanelElement,
  watchLines,
  type WatchDetail,
} from "./panel";
import type { WatchStatus } from "../storage/watchlist";
import type { WatchChange } from "../watchlist/drift";
import type { RosetteInput } from "./rosette";

function sampleReport(overrides: Partial<Report> = {}): Report {
  return {
    serial: "7F2A-0091",
    band: "mixed",
    probability: 0.5,
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
    unavailableSignals: [],
    absentSignals: [],
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

function render(report: Report, pending: string[] = []): ShadowRoot {
  const panel = new VerdictPanelElement();
  panel.render(report, rosetteInput, Date.now(), { pending });
  return getPanelShadowRootForTesting(panel);
}

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

describe("the confidence interval and what could not be read", () => {
  it("states the range the bootstrap produced", () => {
    const root = render(sampleReport({ confidence: { low: 0.1, high: 0.19 } }));
    expect(root.querySelector(".interval-note")?.textContent).toContain("10 to 19 percent");
  });

  it("collapses a range that rounds to one number", () => {
    const root = render(sampleReport({ confidence: { low: 0.142, high: 0.144 } }));
    expect(root.querySelector(".interval-note")?.textContent).toContain("14 percent");
  });

  it("draws a wide band wide, never hidden", () => {
    const narrow = render(sampleReport({ confidence: { low: 0.4, high: 0.45 } }));
    const wide = render(sampleReport({ confidence: { low: 0.1, high: 0.9 } }));
    const width = (root: ShadowRoot) =>
      Number.parseFloat(
        root.querySelector<HTMLElement>(".interval-span")?.style.width.replace("%", "") ?? "0",
      );
    expect(width(wide)).toBeGreaterThan(width(narrow));
  });

  it("says which signal could not be read", () => {
    const root = render(sampleReport({ unavailableSignals: ["different product"] }));
    expect(root.querySelector(".interval-note")?.textContent).toContain(
      "different product could not be read on this page",
    );
  });

  it("joins two unreadable signals rather than listing them twice", () => {
    const root = render(
      sampleReport({ unavailableSignals: ["different product", "verification pattern"] }),
    );
    expect(root.querySelector(".interval-note")?.textContent).toContain(
      "different product and verification pattern could not be read",
    );
  });

  it("says a platform does not record a signal rather than that it could not be read", () => {
    const root = render(sampleReport({ absentSignals: ["verification pattern"] }));
    const note = root.querySelector(".interval-note")?.textContent ?? "";
    expect(note).toContain("This platform does not record verification pattern");
    expect(note).not.toContain("could not be read");
  });

  it("keeps the two apart when a page hid one signal and the platform lacks another", () => {
    const root = render(
      sampleReport({
        absentSignals: ["verification pattern"],
        unavailableSignals: ["different product"],
      }),
    );
    const note = root.querySelector(".interval-note")?.textContent ?? "";
    expect(note).toContain("This platform does not record verification pattern");
    expect(note).toContain("different product could not be read on this page");
  });

  it("says nothing about unreadable signals when every signal was read", () => {
    const root = render(sampleReport());
    expect(root.querySelector(".interval-note")?.textContent).not.toContain("could not be read");
  });
});

describe("the provisional state while a signal is still arriving", () => {
  it("says nothing when every signal is already in", () => {
    expect(render(sampleReport()).querySelector(".pending")).toBeNull();
  });

  it("names the one signal still being read", () => {
    const root = render(sampleReport(), ["reviewer network"]);
    expect(root.querySelector(".pending")?.textContent).toContain(
      "Still reading the reviewer network",
    );
  });

  it("warns that the figure can still move", () => {
    const root = render(sampleReport(), ["reviewer network"]);
    expect(root.querySelector(".pending")?.textContent).toContain("may still move");
  });

  it("joins two pending signals rather than listing them twice", () => {
    const root = render(sampleReport(), ["reviewer network", "duplicate text"]);
    expect(root.querySelector(".pending")?.textContent).toContain(
      "reviewer network and duplicate text",
    );
  });

  it("announces the pending line politely, since it appears after first paint", () => {
    const root = render(sampleReport(), ["reviewer network"]);
    expect(root.querySelector(".pending")?.getAttribute("role")).toBe("status");
  });

  it("drops the pending line when the panel is re-rendered with the final report", () => {
    const panel = new VerdictPanelElement();
    panel.render(sampleReport(), rosetteInput, Date.now(), { pending: ["reviewer network"] });
    panel.render(sampleReport(), rosetteInput, Date.now(), { pending: [] });
    expect(getPanelShadowRootForTesting(panel).querySelector(".pending")).toBeNull();
  });
});

describe("the full report button", () => {
  it("names the report it was showing, so the popup can open that one", () => {
    const panel = new VerdictPanelElement();
    const report = sampleReport();
    panel.render(report, rosetteInput);
    let sent: { serial: string } | null = null;
    panel.addEventListener("verdict:full-report", (event) => {
      sent = (event as CustomEvent<{ serial: string }>).detail;
    });

    getPanelShadowRootForTesting(panel).querySelector<HTMLButtonElement>(".full-report")?.click();

    expect(sent).toEqual({ serial: "7F2A-0091" });
  });

  it("still asks for the popup when the report carries no serial", () => {
    const panel = new VerdictPanelElement();
    panel.render(sampleReport({ serial: "" }), rosetteInput);
    let fired = false;
    panel.addEventListener("verdict:full-report", () => {
      fired = true;
    });

    getPanelShadowRootForTesting(panel).querySelector<HTMLButtonElement>(".full-report")?.click();

    expect(fired).toBe(true);
  });
});

describe("what the panel says about a listing checked before", () => {
  const NOW = Date.parse("2026-03-01T12:00:00Z");

  function check(daysBack: number, band: Report["band"] | null) {
    return { timestamp: NOW - daysBack * 86_400_000, band, adjustedRating: 3.9 };
  }

  it("says nothing at all the first time a listing is seen", () => {
    expect(previouslyLine(sampleReport(), undefined, NOW)).toBeNull();
    const panel = new VerdictPanelElement();
    panel.render(sampleReport(), rosetteInput, NOW, { previousChecks: [] });
    expect(getPanelShadowRootForTesting(panel).querySelector(".previously")).toBeNull();
  });

  it("names the band it read last time when that band has changed", () => {
    expect(previouslyLine(sampleReport(), check(12, "clean"), NOW)).toBe(
      "You checked this listing 12 days ago, when it read clean.",
    );
  });

  it("says the reading has not moved when the band is the same", () => {
    expect(previouslyLine(sampleReport(), check(12, "mixed"), NOW)).toBe(
      "You checked this listing 12 days ago, and it read mixed then too.",
    );
  });

  it("says only when, for a check whose band cannot be read", () => {
    expect(previouslyLine(sampleReport(), check(12, null), NOW)).toBe(
      "You checked this listing 12 days ago.",
    );
  });

  it("reads the same day, yesterday, and a run of days the way a person would", () => {
    expect(previouslyLine(sampleReport(), check(0, null), NOW)).toContain("earlier today");
    expect(previouslyLine(sampleReport(), check(1, null), NOW)).toContain("yesterday");
    expect(previouslyLine(sampleReport(), check(29, null), NOW)).toContain("29 days ago");
  });

  it("rounds to months once days stop being useful", () => {
    expect(previouslyLine(sampleReport(), check(31, null), NOW)).toContain("a month ago");
    expect(previouslyLine(sampleReport(), check(120, null), NOW)).toContain("4 months ago");
  });

  it("renders the line under the interval, and uses only the newest check", () => {
    const panel = new VerdictPanelElement();
    panel.render(sampleReport(), rosetteInput, NOW, {
      previousChecks: [check(2, "clean"), check(40, "doubtful")],
    });

    expect(getPanelShadowRootForTesting(panel).querySelector(".previously")?.textContent).toBe(
      "You checked this listing 2 days ago, when it read clean.",
    );
  });
});

describe("the panel in another locale", () => {
  const german = newTranslator("de-DE", { "panel.claimed": "angegeben" }, "de");

  function renderIn(report: Report): ShadowRoot {
    const panel = new VerdictPanelElement();
    document.body.appendChild(panel);
    panel.render(report, rosetteInput, Date.now(), { translator: german });
    return getPanelShadowRootForTesting(panel);
  }

  it("writes the rating with the reader's own decimal mark", () => {
    expect(renderIn(sampleReport()).querySelector(".claimed")?.textContent).toBe("4,6");
  });

  it("groups review counts the way the reader's locale groups them", () => {
    const summary = renderIn(sampleReport()).querySelector(".summary")?.textContent ?? "";
    expect(summary).toContain("1.208");
    expect(summary).toContain("8.431");
  });

  it("uses a translated line where there is one and english where there is not", () => {
    const root = renderIn(sampleReport());
    expect(root.querySelector(".figures")?.textContent).toContain("angegeben");
    expect(root.querySelector(".figures")?.textContent).toContain("adjusted");
  });

  it("reads a stored report's evidence back through the catalogue", () => {
    const report = sampleReport({
      evidence: [
        {
          signal: "duplicate text",
          strength: "strong",
          value: 0.2,
          detail: "3 clusters of near duplicate text, about 20 percent of reviews with text.",
          messages: [
            {
              id: "evidence.duplicateText.clusters",
              count: 3,
              params: { percent: 20 },
            },
          ],
        },
      ],
    });
    const translated = newTranslator(
      "de-DE",
      { "evidence.duplicateText.clusters": { one: "ein Block", other: "{count} Blocke, {percent} Prozent" } },
      "de",
    );
    const panel = new VerdictPanelElement();
    document.body.appendChild(panel);
    panel.render(report, rosetteInput, Date.now(), { translator: translated });
    expect(getPanelShadowRootForTesting(panel).querySelector(".detail")?.textContent).toBe(
      "3 Blocke, 20 Prozent",
    );
  });

  it("falls back to the stored english for a row saved before messages existed", () => {
    const panel = new VerdictPanelElement();
    document.body.appendChild(panel);
    panel.render(sampleReport(), rosetteInput, Date.now(), { translator: german });
    expect(getPanelShadowRootForTesting(panel).querySelector(".detail")?.textContent).toBe(
      "the rating histogram does not look organic",
    );
  });
});

describe("the watchlist on the panel", () => {
  const SAVED = Date.parse("2026-03-01T12:00:00Z");
  const NOW = SAVED + 86_400_000 * 3;

  function watching(changes: WatchChange[] = []): WatchStatus {
    return {
      watching: true,
      entry: {
        productKey: "key-1",
        site: "amazon",
        title: "a stovetop kettle",
        thumbnailUrl: null,
        savedAt: SAVED,
        lastSeenAt: NOW,
        checkCount: 2,
        baseline: {
          at: SAVED,
          band: "mostly-clean",
          probability: 0.2,
          claimedRating: 4.6,
          adjustedRating: 4.4,
          totalReviewCount: 400,
          features: null,
        },
        latest: {
          at: NOW,
          band: "doubtful",
          probability: 0.6,
          claimedRating: 4.6,
          adjustedRating: 3.9,
          totalReviewCount: 400,
          features: null,
        },
      },
      changes,
    };
  }

  function mounted(watch?: WatchStatus): VerdictPanelElement {
    const panel = new VerdictPanelElement();
    document.body.appendChild(panel);
    panel.render(sampleReport(), rosetteInput, NOW, { watch });
    return panel;
  }

  it("offers to keep an eye on a listing nobody saved", () => {
    const toggle = getPanelShadowRootForTesting(mounted()).querySelector(".watch-toggle");

    expect(toggle?.textContent).toBe("Keep an eye on this");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
  });

  it("offers to let go of one that is saved", () => {
    const toggle = getPanelShadowRootForTesting(mounted(watching())).querySelector(".watch-toggle");

    expect(toggle?.textContent).toBe("Stop watching");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
  });

  it("says plainly when nothing has moved since it was saved", () => {
    const root = getPanelShadowRootForTesting(mounted(watching()));

    expect(root.querySelector(".watch")?.textContent).toContain(
      "Nothing has moved since you saved it 3 days ago.",
    );
  });

  it("leads with what moved when something did", () => {
    const root = getPanelShadowRootForTesting(
      mounted(watching([{ kind: "band", from: "mostly-clean", to: "doubtful" }])),
    );

    const lines = [...root.querySelectorAll(".watch p")].map((line) => line.textContent);
    expect(lines).toEqual([
      "Since you saved it 3 days ago:",
      "It read mostly clean then, and reads doubtful now.",
    ]);
  });

  it("shows nothing at all about watching when the listing is not watched", () => {
    expect(getPanelShadowRootForTesting(mounted()).querySelector(".watch")).toBeNull();
  });

  it("asks for the state the reader pressed for, not the one it was in", () => {
    const panel = mounted();
    const asked: boolean[] = [];
    panel.addEventListener("verdict:watch", (event) => {
      asked.push((event as CustomEvent<WatchDetail>).detail.watching);
    });

    getPanelShadowRootForTesting(panel).querySelector<HTMLButtonElement>(".watch-toggle")?.click();

    expect(asked).toEqual([true]);
  });

  it("asks to stop when it is already watching", () => {
    const panel = mounted(watching());
    const asked: boolean[] = [];
    panel.addEventListener("verdict:watch", (event) => {
      asked.push((event as CustomEvent<WatchDetail>).detail.watching);
    });

    getPanelShadowRootForTesting(panel).querySelector<HTMLButtonElement>(".watch-toggle")?.click();

    expect(asked).toEqual([false]);
  });
});

describe("watchLines", () => {
  it("says nothing about a listing nobody saved", () => {
    expect(watchLines(undefined, Date.now())).toEqual([]);
    expect(watchLines({ watching: false, entry: null, changes: [] }, Date.now())).toEqual([]);
  });
});
