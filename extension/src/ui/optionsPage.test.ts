// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { renderOptions } from "./optionsPage";

function callbacks() {
  return {
    onToggleHistory: vi.fn(),
    onToggleReputationLookup: vi.fn(),
    onToggleGraphContribution: vi.fn(),
    onExportJson: vi.fn(),
    onExportCsv: vi.fn(),
    onDeleteAll: vi.fn(),
  };
}

function state(overrides: Partial<Parameters<typeof renderOptions>[1]> = {}) {
  return {
    historyEnabled: true,
    reputationLookupEnabled: false,
    graphContributionEnabled: false,
    ...overrides,
  };
}

describe("renderOptions", () => {
  it("reflects the current history toggle state", () => {
    const container = document.createElement("div");
    renderOptions(container, state({ historyEnabled: true }), callbacks());
    expect(container.querySelector<HTMLInputElement>(".history-toggle")?.checked).toBe(true);
  });

  it("reflects a disabled history toggle state", () => {
    const container = document.createElement("div");
    renderOptions(container, state({ historyEnabled: false }), callbacks());
    expect(container.querySelector<HTMLInputElement>(".history-toggle")?.checked).toBe(false);
  });

  it("calls onToggleHistory with the new checked state", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderOptions(container, state({ historyEnabled: false }), cbs);

    const toggle = container.querySelector<HTMLInputElement>(".history-toggle") as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));

    expect(cbs.onToggleHistory).toHaveBeenCalledWith(true);
  });

  it("reflects the current reputation lookup toggle state", () => {
    const container = document.createElement("div");
    renderOptions(container, state({ reputationLookupEnabled: true }), callbacks());
    expect(container.querySelector<HTMLInputElement>(".reputation-toggle")?.checked).toBe(true);
  });

  it("calls onToggleReputationLookup with the new checked state", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderOptions(container, state(), cbs);

    const toggle = container.querySelector<HTMLInputElement>(".reputation-toggle") as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));

    expect(cbs.onToggleReputationLookup).toHaveBeenCalledWith(true);
  });

  it("calls onExportJson and onExportCsv when clicked", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderOptions(container, state(), cbs);

    container.querySelector<HTMLButtonElement>(".export-json")?.click();
    container.querySelector<HTMLButtonElement>(".export-csv")?.click();

    expect(cbs.onExportJson).toHaveBeenCalledOnce();
    expect(cbs.onExportCsv).toHaveBeenCalledOnce();
  });

  it("requires a second click on delete everything before calling onDeleteAll", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderOptions(container, state(), cbs);

    const button = container.querySelector<HTMLButtonElement>(".delete-all");
    button?.click();
    expect(cbs.onDeleteAll).not.toHaveBeenCalled();
    expect(button?.textContent).toBe("Confirm delete");

    button?.click();
    expect(cbs.onDeleteAll).toHaveBeenCalledOnce();
  });

  describe("graph contribution, PRIVACY.md section 5's disclosure before consent", () => {
    it("reflects the current toggle state", () => {
      const container = document.createElement("div");
      renderOptions(container, state({ graphContributionEnabled: true }), callbacks());
      expect(container.querySelector<HTMLInputElement>(".contribution-toggle")?.checked).toBe(true);
    });

    it("starts with the disclosure hidden", () => {
      const container = document.createElement("div");
      renderOptions(container, state(), callbacks());
      expect(container.querySelector<HTMLElement>(".disclosure")?.hidden).toBe(true);
    });

    it("checking the box reveals the disclosure instead of calling back immediately", () => {
      const container = document.createElement("div");
      const cbs = callbacks();
      renderOptions(container, state(), cbs);

      const toggle = container.querySelector<HTMLInputElement>(".contribution-toggle") as HTMLInputElement;
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change"));

      expect(cbs.onToggleGraphContribution).not.toHaveBeenCalled();
      expect(container.querySelector<HTMLElement>(".disclosure")?.hidden).toBe(false);
    });

    it("only calls onToggleGraphContribution(true) after Confirm, not merely checking the box", () => {
      const container = document.createElement("div");
      const cbs = callbacks();
      renderOptions(container, state(), cbs);

      const toggle = container.querySelector<HTMLInputElement>(".contribution-toggle") as HTMLInputElement;
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change"));
      container.querySelector<HTMLButtonElement>(".contribution-confirm")?.click();

      expect(cbs.onToggleGraphContribution).toHaveBeenCalledWith(true);
      expect(container.querySelector<HTMLElement>(".disclosure")?.hidden).toBe(true);
    });

    it("Cancel hides the disclosure and unchecks the box without calling back", () => {
      const container = document.createElement("div");
      const cbs = callbacks();
      renderOptions(container, state(), cbs);

      const toggle = container.querySelector<HTMLInputElement>(".contribution-toggle") as HTMLInputElement;
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change"));
      container.querySelector<HTMLButtonElement>(".contribution-cancel")?.click();

      expect(cbs.onToggleGraphContribution).not.toHaveBeenCalled();
      expect(toggle.checked).toBe(false);
      expect(container.querySelector<HTMLElement>(".disclosure")?.hidden).toBe(true);
    });

    it("unchecking an enabled box calls back immediately, with no disclosure to show", () => {
      const container = document.createElement("div");
      const cbs = callbacks();
      renderOptions(container, state({ graphContributionEnabled: true }), cbs);

      const toggle = container.querySelector<HTMLInputElement>(".contribution-toggle") as HTMLInputElement;
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change"));

      expect(cbs.onToggleGraphContribution).toHaveBeenCalledWith(false);
    });
  });
});
