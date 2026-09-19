// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { WatchEntry } from "../storage/watchlist";
import type { WatchReading } from "../watchlist/reading";
import { bindWatchlist, watchlistMarkup } from "./watchlistView";

const NOW = Date.parse("2026-03-01T12:00:00Z");

function reading(overrides: Partial<WatchReading> = {}): WatchReading {
  return {
    at: NOW,
    band: "mostly-clean",
    probability: 0.2,
    claimedRating: 4.6,
    adjustedRating: 4.4,
    totalReviewCount: 400,
    features: null,
    ...overrides,
  };
}

function entry(overrides: Partial<WatchEntry> = {}): WatchEntry {
  return {
    productKey: "key-1",
    site: "amazon",
    title: "a stovetop kettle",
    thumbnailUrl: null,
    savedAt: NOW,
    lastSeenAt: NOW,
    checkCount: 1,
    baseline: reading(),
    latest: reading(),
    ...overrides,
  };
}

function render(entries: readonly WatchEntry[]): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = watchlistMarkup(entries);
  return container;
}

describe("watchlistMarkup", () => {
  it("says nothing at all when nothing is watched", () => {
    expect(watchlistMarkup([])).toBe("");
  });

  it("names a watched listing and what it reads now", () => {
    const container = render([entry()]);

    expect(container.querySelector(".title")?.textContent).toBe("a stovetop kettle");
    expect(container.querySelector(".band")?.textContent).toBe("mostly clean");
    expect(container.querySelector(".moved")?.textContent).toContain("nothing moved");
  });

  it("lists what has moved since it was saved", () => {
    const container = render([
      entry({ latest: reading({ band: "doubtful", adjustedRating: 3.5 }) }),
    ]);

    expect(container.querySelector(".moved")?.textContent).toContain("2 things moved");
    expect([...container.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "It read mostly clean then, and reads doubtful now.",
      "The adjusted rating moved from 4.4 to 3.5.",
    ]);
  });

  it("escapes a title the seller wrote", () => {
    const container = render([entry({ title: "<script>alert(1)</script>" })]);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector(".title")?.textContent).toBe("<script>alert(1)</script>");
  });

  it("shows no image for a thumbnail from a host the registry does not serve", () => {
    const container = render([entry({ thumbnailUrl: "https://example.invalid/a.png" })]);

    expect(container.querySelector("img")).toBeNull();
  });
});

describe("bindWatchlist", () => {
  it("asks to stop watching the listing whose button was pressed", () => {
    const container = render([entry(), entry({ productKey: "key-2", title: "a cable" })]);
    const onUnwatch = vi.fn();

    bindWatchlist(container, { onUnwatch });
    container.querySelectorAll<HTMLButtonElement>(".unwatch")[1]?.click();

    expect(onUnwatch).toHaveBeenCalledWith("key-2");
  });

  it("does nothing when nobody is listening", () => {
    const container = render([entry()]);

    bindWatchlist(container, {});

    expect(() => container.querySelector<HTMLButtonElement>(".unwatch")?.click()).not.toThrow();
  });
});
