// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "../storage/history";
import { renderPopup } from "./historyList";

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

describe("renderPopup", () => {
  it("shows an empty state when there is no history", () => {
    const container = document.createElement("div");
    renderPopup(container, [], { onExportJson: vi.fn(), onExportCsv: vi.fn(), onDeleteAll: vi.fn() });
    expect(container.querySelector(".empty")?.textContent).toBe("No checks yet.");
  });

  it("renders a row per entry, with title and formatted date", () => {
    const container = document.createElement("div");
    renderPopup(container, [entry({ title: "wireless mouse" })], {
      onExportJson: vi.fn(),
      onExportCsv: vi.fn(),
      onDeleteAll: vi.fn(),
    });
    expect(container.querySelector(".title")?.textContent).toBe("wireless mouse");
    expect(container.querySelector(".date")?.textContent).toBe("Jan 15, 2026");
  });

  it("shows the band and adjusted rating when the report carries them", () => {
    const container = document.createElement("div");
    renderPopup(container, [entry({ report: { band: "mixed", adjustedRating: 3.9 } })], {
      onExportJson: vi.fn(),
      onExportCsv: vi.fn(),
      onDeleteAll: vi.fn(),
    });
    expect(container.querySelector(".band")?.textContent).toBe("mixed");
    expect(container.querySelector(".rating")?.textContent).toBe("3.9");
  });

  it("omits the band and rating for a legacy or malformed report rather than crashing", () => {
    const container = document.createElement("div");
    expect(() =>
      renderPopup(container, [entry({ report: "not an object" })], {
        onExportJson: vi.fn(),
        onExportCsv: vi.fn(),
        onDeleteAll: vi.fn(),
      }),
    ).not.toThrow();
    expect(container.querySelector(".band")).toBeNull();
    expect(container.querySelector(".rating")).toBeNull();
  });

  it("calls onExportJson and onExportCsv when their buttons are clicked", () => {
    const container = document.createElement("div");
    const onExportJson = vi.fn();
    const onExportCsv = vi.fn();
    renderPopup(container, [], { onExportJson, onExportCsv, onDeleteAll: vi.fn() });

    container.querySelector<HTMLButtonElement>(".export-json")?.click();
    container.querySelector<HTMLButtonElement>(".export-csv")?.click();

    expect(onExportJson).toHaveBeenCalledOnce();
    expect(onExportCsv).toHaveBeenCalledOnce();
  });

  it("requires a second click on delete everything before calling onDeleteAll", () => {
    const container = document.createElement("div");
    const onDeleteAll = vi.fn();
    renderPopup(container, [], { onExportJson: vi.fn(), onExportCsv: vi.fn(), onDeleteAll });

    const button = container.querySelector<HTMLButtonElement>(".delete-all");
    button?.click();
    expect(onDeleteAll).not.toHaveBeenCalled();
    expect(button?.textContent).toBe("confirm delete");

    button?.click();
    expect(onDeleteAll).toHaveBeenCalledOnce();
  });
});
