// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Holdings } from "../storage/holdings";
import { renderOptions } from "./optionsPage";

function callbacks() {
  return {
    onToggleHistory: vi.fn(),
    onToggleReputationLookup: vi.fn(),
    onToggleGraphContribution: vi.fn(),
    onExportJson: vi.fn(),
    onExportCsv: vi.fn(),
    onDeleteAll: vi.fn(),
    onClearCache: vi.fn(),
    onClearQueue: vi.fn(),
    onAcknowledgePolicy: vi.fn(),
    onImport: vi.fn(),
  };
}

const NOTHING_HELD: Holdings = {
  checks: 0,
  cachedProducts: 0,
  oldestCachedAt: null,
  queuedContributions: 0,
  nextContributionAt: null,
};

function state(overrides: Partial<Parameters<typeof renderOptions>[1]> = {}) {
  return {
    historyEnabled: true,
    reputationLookupEnabled: false,
    graphContributionEnabled: false,
    holdings: NOTHING_HELD,
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

describe("the history loss notice", () => {
  it("warns that uninstalling deletes history, beside the export buttons", () => {
    const container = document.createElement("div");
    renderOptions(container, state(), callbacks());
    const section = container.querySelector(".setting:last-of-type");
    expect(section?.textContent).toContain("Uninstalling Verdict deletes it");
    expect(section?.querySelector(".export-json")).not.toBeNull();
  });
});

describe("what this browser is holding", () => {
  const NOW = Date.parse("2026-03-01T12:00:00Z");

  function held(overrides: Partial<Holdings> = {}) {
    return state({ holdings: { ...NOTHING_HELD, ...overrides }, now: NOW });
  }

  it("says plainly when it is holding nothing", () => {
    const container = document.createElement("div");
    renderOptions(container, held(), callbacks());

    const text = container.querySelector(".holdings")?.textContent ?? "";
    expect(text).toContain("No checks saved.");
    expect(text).toContain("No review pages held.");
    expect(text).toContain("Nothing waiting to be sent.");
  });

  it("counts the checks it has saved", () => {
    const container = document.createElement("div");
    renderOptions(container, held({ checks: 1204 }), callbacks());
    expect(container.querySelector(".holdings")?.textContent).toContain("1,204 checks saved");
  });

  it("counts the listings it has cached, and when the oldest was read", () => {
    const container = document.createElement("div");
    renderOptions(
      container,
      held({ cachedProducts: 3, oldestCachedAt: NOW - 2 * 86_400_000 }),
      callbacks(),
    );

    const text = container.querySelector(".holdings")?.textContent ?? "";
    expect(text).toContain("3 listings held, without review text.");
    expect(text).toContain("read 2 days ago");
  });

  it("says how much is queued and when the first of it leaves", () => {
    const container = document.createElement("div");
    renderOptions(
      container,
      held({ queuedContributions: 42, nextContributionAt: NOW + 2 * 60 * 60 * 1000 }),
      callbacks(),
    );

    const text = container.querySelector(".holdings")?.textContent ?? "";
    expect(text).toContain("42 hashed rows waiting to be sent.");
    expect(text).toContain("in about 2 hours");
  });

  it("clears the cached review pages when asked", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderOptions(container, held({ cachedProducts: 3 }), cbs);

    container.querySelector<HTMLButtonElement>(".clear-cache")?.click();

    expect(cbs.onClearCache).toHaveBeenCalledOnce();
  });

  it("clears what is waiting to be sent when asked", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderOptions(container, held({ queuedContributions: 42 }), cbs);

    container.querySelector<HTMLButtonElement>(".clear-queue")?.click();

    expect(cbs.onClearQueue).toHaveBeenCalledOnce();
  });

  it("offers no button to clear something it is not holding", () => {
    const container = document.createElement("div");
    renderOptions(container, held(), callbacks());

    expect(container.querySelector<HTMLButtonElement>(".clear-cache")?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(".clear-queue")?.disabled).toBe(true);
  });
});

describe("the privacy notice", () => {
  const CHANGE = {
    version: 4,
    effectiveAt: Date.UTC(2026, 5, 1),
    summary: "Reputation lookups will batch across tabs.",
  };

  it("is absent when nothing has changed", () => {
    const container = document.createElement("div");
    renderOptions(container, state(), callbacks());
    expect(container.querySelector(".policy-notice")).toBeNull();
  });

  it("sits above the switches it is about", () => {
    const container = document.createElement("div");
    renderOptions(container, state({ pendingPolicyChanges: [CHANGE] }), callbacks());
    const notice = container.querySelector(".policy-notice");
    const firstSetting = container.querySelector(".setting");
    if (notice === null || firstSetting === null) {
      throw new Error("the notice and the settings should both be rendered");
    }
    const position = notice.compareDocumentPosition(firstSetting);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("acknowledges on request", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderOptions(container, state({ pendingPolicyChanges: [CHANGE] }), cbs);
    container.querySelector<HTMLButtonElement>(".policy-ack")?.click();
    expect(cbs.onAcknowledgePolicy).toHaveBeenCalledTimes(1);
  });
});

describe("importing history", () => {
  it("offers an import next to the exports", () => {
    const container = document.createElement("div");
    renderOptions(container, state(), callbacks());
    expect(container.querySelector(".import-history")).not.toBeNull();
  });

  it("says that csv cannot come back in", () => {
    const container = document.createElement("div");
    renderOptions(container, state(), callbacks());
    expect(container.textContent).toContain("CSV is for spreadsheets and cannot be imported");
  });

  it("accepts only json, so a csv is not offered in the picker", () => {
    const container = document.createElement("div");
    renderOptions(container, state(), callbacks());
    const input = container.querySelector<HTMLInputElement>(".import-file");
    expect(input?.accept).toBe("application/json,.json");
  });

  it("hands the chosen file to the callback", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderOptions(container, state(), cbs);
    const input = container.querySelector<HTMLInputElement>(".import-file");
    if (input === null) {
      throw new Error("no file input");
    }
    const file = new File(["[]"], "verdict-history.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change"));
    expect(cbs.onImport).toHaveBeenCalledWith(file);
  });

  it("says nothing when no file was chosen", () => {
    const container = document.createElement("div");
    const cbs = callbacks();
    renderOptions(container, state(), cbs);
    const input = container.querySelector<HTMLInputElement>(".import-file");
    input?.dispatchEvent(new Event("change"));
    expect(cbs.onImport).not.toHaveBeenCalled();
  });

  it("shows nothing until an import has run", () => {
    const container = document.createElement("div");
    renderOptions(container, state(), callbacks());
    expect(container.querySelector(".import-result")).toBeNull();
  });

  it("reports the result where a screen reader will announce it", () => {
    const container = document.createElement("div");
    renderOptions(container, state({ importMessage: "Added 23 checks." }), callbacks());
    const result = container.querySelector(".import-result");
    expect(result?.textContent).toContain("Added 23 checks.");
    expect(result?.getAttribute("role")).toBe("status");
  });

  it("escapes a message rather than rendering it", () => {
    const container = document.createElement("div");
    renderOptions(container, state({ importMessage: "<img src=x onerror=alert(1)>" }), callbacks());
    expect(container.querySelector(".import-result img")).toBeNull();
  });
});
