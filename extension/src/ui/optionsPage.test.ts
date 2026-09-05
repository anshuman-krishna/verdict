// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { renderOptions } from "./optionsPage";

function callbacks() {
  return {
    onToggleHistory: vi.fn(),
    onExportJson: vi.fn(),
    onExportCsv: vi.fn(),
    onDeleteAll: vi.fn(),
  };
}

describe("renderOptions", () => {
  it("reflects the current history toggle state", () => {
    const container = document.createElement("div");
    renderOptions(container, { historyEnabled: true }, callbacks());
    expect(container.querySelector<HTMLInputElement>(".history-toggle")?.checked).toBe(true);
  });

  it("reflects a disabled history toggle state", () => {
    const container = document.createElement("div");
    renderOptions(container, { historyEnabled: false }, callbacks());
    expect(container.querySelector<HTMLInputElement>(".history-toggle")?.checked).toBe(false);
  });

  it("calls onToggleHistory with the new checked state", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderOptions(container, { historyEnabled: false }, cbs);

    const toggle = container.querySelector<HTMLInputElement>(".history-toggle") as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));

    expect(cbs.onToggleHistory).toHaveBeenCalledWith(true);
  });

  it("calls onExportJson and onExportCsv when clicked", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderOptions(container, { historyEnabled: true }, cbs);

    container.querySelector<HTMLButtonElement>(".export-json")?.click();
    container.querySelector<HTMLButtonElement>(".export-csv")?.click();

    expect(cbs.onExportJson).toHaveBeenCalledOnce();
    expect(cbs.onExportCsv).toHaveBeenCalledOnce();
  });

  it("requires a second click on delete everything before calling onDeleteAll", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderOptions(container, { historyEnabled: true }, cbs);

    const button = container.querySelector<HTMLButtonElement>(".delete-all");
    button?.click();
    expect(cbs.onDeleteAll).not.toHaveBeenCalled();
    expect(button?.textContent).toBe("Confirm delete");

    button?.click();
    expect(cbs.onDeleteAll).toHaveBeenCalledOnce();
  });
});
