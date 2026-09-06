// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "../storage/history";
import { renderPopup, type PopupCallbacks } from "./historyList";

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 1,
    // noon utc, so the formatted local date stays "Jan 15" across any
    // realistic timezone offset rather than rolling to the previous day
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
});
