// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "../storage/history";
import { groupByProduct, matchesQuery, renderPopup, type PopupCallbacks } from "./historyList";

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 1,
    timestamp: Date.parse("2026-01-15T12:00:00Z"),
    title: "a product",
    thumbnailUrl: null,
    report: null,
    ...overrides,
  };
}

function callbacks(overrides: Partial<PopupCallbacks> = {}): PopupCallbacks {
  return {
    onExportJson: vi.fn(),
    onExportCsv: vi.fn(),
    onDeleteAll: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
}

describe("renderPopup", () => {
  it("shows an empty state when there is no history", () => {
    const container = document.createElement("div");
    renderPopup(container, [], callbacks());
    expect(container.querySelector(".empty")?.textContent).toBe("No checks yet.");
  });

  it("renders a row per entry, with title and formatted date", () => {
    const container = document.createElement("div");
    renderPopup(container, [entry({ title: "wireless mouse" })], callbacks());
    expect(container.querySelector(".title")?.textContent).toBe("wireless mouse");
    expect(container.querySelector(".date")?.textContent).toBe("Jan 15, 2026");
  });

  it("escapes a title lifted from the page, since a seller controls that text", () => {
    const container = document.createElement("div");
    renderPopup(container, [entry({ title: `<img src=x onerror=alert(1)>` })], callbacks());
    expect(container.querySelector(".title")?.textContent).toBe(`<img src=x onerror=alert(1)>`);
    expect(container.querySelectorAll(".row img").length).toBe(0);
  });

  it("shows the band and adjusted rating when the report carries them", () => {
    const container = document.createElement("div");
    renderPopup(container, [entry({ report: { band: "mixed", adjustedRating: 3.9 } })], callbacks());
    expect(container.querySelector(".band")?.textContent).toBe("mixed");
    expect(container.querySelector(".rating")?.textContent).toBe("3.9");
  });

  it("omits the band and rating for a legacy or malformed report rather than crashing", () => {
    const container = document.createElement("div");
    expect(() =>
      renderPopup(container, [entry({ report: "not an object" })], callbacks()),
    ).not.toThrow();
    expect(container.querySelector(".band")).toBeNull();
    expect(container.querySelector(".rating")).toBeNull();
  });

  it("calls onExportJson and onExportCsv when their buttons are clicked", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderPopup(container, [], cbs);

    container.querySelector<HTMLButtonElement>(".export-json")?.click();
    container.querySelector<HTMLButtonElement>(".export-csv")?.click();

    expect(cbs.onExportJson).toHaveBeenCalledOnce();
    expect(cbs.onExportCsv).toHaveBeenCalledOnce();
  });

  it("requires a second click on delete everything before calling onDeleteAll", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderPopup(container, [], cbs);

    const button = container.querySelector<HTMLButtonElement>(".delete-all");
    button?.click();
    expect(cbs.onDeleteAll).not.toHaveBeenCalled();
    expect(button?.textContent).toBe("confirm delete");

    button?.click();
    expect(cbs.onDeleteAll).toHaveBeenCalledOnce();
  });

  it("calls onOpenSettings when the settings button is clicked", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderPopup(container, [], cbs);

    container.querySelector<HTMLButtonElement>(".open-settings")?.click();

    expect(cbs.onOpenSettings).toHaveBeenCalledOnce();
  });

  describe("a thumbnail url is whatever the seller put on the page", () => {
    it("does not let one break out of its attribute and run script", () => {
      const container = document.createElement("div");
      renderPopup(
        container,
        [entry({ thumbnailUrl: `https://www.amazon.com/a.jpg" onerror="globalThis.pwned = 1` })],
        callbacks(),
      );

      const img = container.querySelector("img");
      expect(img?.getAttribute("onerror")).toBeNull();
      expect(container.innerHTML).not.toContain("onerror=\"globalThis");
    });

    it("renders no image at all for a host verdict does not support", () => {
      const container = document.createElement("div");
      renderPopup(container, [entry({ thumbnailUrl: "https://tracker.example/pixel.gif" })], callbacks());

      expect(container.querySelector("img")).toBeNull();
    });

    it("renders no image for a javascript or data url", () => {
      for (const thumbnailUrl of ["javascript:alert(1)", "data:image/svg+xml,<svg onload=alert(1)>"]) {
        const container = document.createElement("div");
        renderPopup(container, [entry({ thumbnailUrl })], callbacks());
        expect(container.querySelector("img")).toBeNull();
      }
    });

    it("still renders a thumbnail served by a supported storefront", () => {
      const container = document.createElement("div");
      const thumbnailUrl = "https://www.amazon.co.uk/images/I/a.jpg";
      renderPopup(container, [entry({ thumbnailUrl })], callbacks());

      expect(container.querySelector("img")?.getAttribute("src")).toBe(thumbnailUrl);
    });
  });
});

describe("opening one check from the list", () => {
  it("hands back the id of the row that was clicked", () => {
    const container = document.createElement("div");
    const onOpenEntry = vi.fn();
    renderPopup(
      container,
      [entry({ id: 4, title: "first" }), entry({ id: 9, title: "second" })],
      callbacks({ onOpenEntry }),
    );

    container.querySelectorAll<HTMLButtonElement>(".row")[1]?.click();

    expect(onOpenEntry).toHaveBeenCalledWith(9);
  });

  it("makes every row reachable from the keyboard", () => {
    const container = document.createElement("div");
    renderPopup(container, [entry()], callbacks());
    expect(container.querySelector(".row")?.tagName).toBe("BUTTON");
  });

  it("does not fail when nothing is listening for the click", () => {
    const container = document.createElement("div");
    renderPopup(container, [entry()], callbacks());
    expect(() => container.querySelector<HTMLButtonElement>(".row")?.click()).not.toThrow();
  });
});

describe("searching the history", () => {
  it("shows no search box until there is something to search", () => {
    const container = document.createElement("div");
    renderPopup(container, [], callbacks());
    expect(container.querySelector(".search-input")).toBeNull();
  });

  it("narrows the rows to titles that contain what was typed", () => {
    const container = document.createElement("div");
    renderPopup(
      container,
      [entry({ id: 1, title: "wireless mouse" }), entry({ id: 2, title: "desk lamp" })],
      callbacks(),
    );

    const search = container.querySelector<HTMLInputElement>(".search-input") as HTMLInputElement;
    search.value = "lamp";
    search.dispatchEvent(new Event("input"));

    expect(container.querySelectorAll(".row").length).toBe(1);
    expect(container.querySelector(".title")?.textContent).toBe("desk lamp");
  });

  it("ignores case and surrounding spaces", () => {
    expect(matchesQuery(entry({ title: "Wireless Mouse" }), "  mouse ")).toBe(true);
  });

  it("keeps everything for an empty query", () => {
    expect(matchesQuery(entry({ title: "anything" }), "")).toBe(true);
  });

  it("says so when nothing matches, rather than looking empty", () => {
    const container = document.createElement("div");
    renderPopup(container, [entry({ title: "wireless mouse" })], callbacks());
    const search = container.querySelector<HTMLInputElement>(".search-input") as HTMLInputElement;
    search.value = "nothing like it";
    search.dispatchEvent(new Event("input"));

    expect(container.querySelector(".empty")?.textContent).toBe("No checks match that.");
  });

  it("keeps what was typed in the box after rerendering", () => {
    const container = document.createElement("div");
    renderPopup(container, [entry({ title: "wireless mouse" })], callbacks());
    const search = container.querySelector<HTMLInputElement>(".search-input") as HTMLInputElement;
    search.value = "mouse";
    search.dispatchEvent(new Event("input"));

    expect(container.querySelector<HTMLInputElement>(".search-input")?.value).toBe("mouse");
  });
});

describe("the band a row shows", () => {
  it("prefers what the current model reads over the band stored at the time", () => {
    const container = document.createElement("div");
    renderPopup(
      container,
      [
        {
          ...entry({ report: { band: "mixed", adjustedRating: 3.9 } }),
          rescored: { band: "doubtful", probability: 0.7, unavailableSignals: [] },
        },
      ],
      callbacks(),
    );

    expect(container.querySelector(".band")?.textContent).toBe("doubtful");
  });

  it("keeps the stored band when there is no model to score against", () => {
    const container = document.createElement("div");
    renderPopup(
      container,
      [{ ...entry({ report: { band: "mixed", adjustedRating: 3.9 } }), rescored: null }],
      callbacks(),
    );

    expect(container.querySelector(".band")?.textContent).toBe("mixed");
  });
});

describe("repeat checks of one listing", () => {
  it("shows one row per listing, standing for its newest check", () => {
    const container = document.createElement("div");
    renderPopup(
      container,
      [
        entry({ id: 3, title: "wireless mouse", productKey: "k1" }),
        entry({ id: 2, title: "wireless mouse", productKey: "k1" }),
        entry({ id: 1, title: "desk lamp", productKey: "k2" }),
      ],
      callbacks(),
    );

    expect(container.querySelectorAll(".row").length).toBe(2);
    expect(container.querySelector<HTMLButtonElement>(".row")?.dataset.id).toBe("3");
  });

  it("says how many checks a row stands for, once there is more than one", () => {
    const container = document.createElement("div");
    renderPopup(
      container,
      [
        entry({ id: 3, productKey: "k1" }),
        entry({ id: 2, productKey: "k1" }),
        entry({ id: 1, productKey: "k1" }),
      ],
      callbacks(),
    );

    expect(container.querySelector(".repeat")?.textContent).toBe("3×");
  });

  it("says nothing about a count for a listing checked once", () => {
    const container = document.createElement("div");
    renderPopup(container, [entry({ productKey: "k1" })], callbacks());
    expect(container.querySelector(".repeat")).toBeNull();
  });

  it("keeps entries from before the key existed as separate rows", () => {
    const container = document.createElement("div");
    renderPopup(container, [entry({ id: 2 }), entry({ id: 1 })], callbacks());
    expect(container.querySelectorAll(".row").length).toBe(2);
  });

  it("counts without reordering what listHistory already sorted", () => {
    const grouped = groupByProduct([
      entry({ id: 3, title: "newest", productKey: "k1" }),
      entry({ id: 2, title: "other", productKey: "k2" }),
      entry({ id: 1, title: "older", productKey: "k1" }),
    ]);

    expect(grouped.map((row) => row.title)).toEqual(["newest", "other"]);
    expect(grouped[0]?.checkCount).toBe(2);
  });
});

describe("the privacy notice in the popup", () => {
  const CHANGE = {
    version: 4,
    effectiveAt: Date.UTC(2026, 5, 1),
    summary: "Reputation lookups will batch across tabs.",
  };
  const NOW = Date.UTC(2026, 2, 1);

  it("is absent when nothing has changed", () => {
    const container = document.createElement("div");
    renderPopup(container, [entry()], callbacks());
    expect(container.querySelector(".policy-notice")).toBeNull();
  });

  it("shows above an empty history too, since that is where a new user lands", () => {
    const container = document.createElement("div");
    renderPopup(container, [], callbacks(), "", { pendingPolicyChanges: [CHANGE], now: NOW });
    expect(container.querySelector(".policy-notice")).not.toBeNull();
  });

  it("acknowledges on request", () => {
    const container = document.createElement("div");
    const onAcknowledgePolicy = vi.fn();
    renderPopup(container, [entry()], callbacks({ onAcknowledgePolicy }), "", {
      pendingPolicyChanges: [CHANGE],
      now: NOW,
    });
    container.querySelector<HTMLButtonElement>(".policy-ack")?.click();
    expect(onAcknowledgePolicy).toHaveBeenCalledTimes(1);
  });

  it("survives a search, which rerenders the whole popup", () => {
    const container = document.createElement("div");
    renderPopup(container, [entry()], callbacks(), "", { pendingPolicyChanges: [CHANGE], now: NOW });
    const search = container.querySelector<HTMLInputElement>(".search-input");
    if (search === null) {
      throw new Error("no search box");
    }
    search.value = "nothing matches this";
    search.dispatchEvent(new Event("input"));
    expect(container.querySelector(".policy-notice")).not.toBeNull();
  });
});
