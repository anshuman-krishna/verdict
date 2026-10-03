import { describe, expect, it, vi } from "vitest";
import {
  answerCommand,
  isPanelHiddenOnActiveTab,
  SHOW_PANEL_COMMAND,
  showPanelOnActiveTab,
  type TabsPort,
} from "./activeTabPanel";
import { PANEL_REOPEN, PANEL_STATUS } from "./panelMessages";

function tabs(reply: unknown, tabId: number | undefined = 7): TabsPort & { sendMessage: ReturnType<typeof vi.fn> } {
  return {
    query: vi.fn(async () => [{ id: tabId }]),
    sendMessage: vi.fn(async () => reply),
  };
}

describe("asking the tab behind the popup", () => {
  it("asks the active tab for its panel status", async () => {
    const port = tabs({ hidden: true });
    expect(await isPanelHiddenOnActiveTab(port)).toBe(true);
    expect(port.sendMessage).toHaveBeenCalledWith(7, { type: PANEL_STATUS });
  });

  it("treats a tab with no content script as nothing to offer", async () => {
    const port = tabs(null);
    port.sendMessage.mockRejectedValue(new Error("Could not establish connection"));
    expect(await isPanelHiddenOnActiveTab(port)).toBe(false);
  });

  it("does not trust an answer of the wrong shape", async () => {
    expect(await isPanelHiddenOnActiveTab(tabs({ hidden: "yes" }))).toBe(false);
    expect(await isPanelHiddenOnActiveTab(tabs(undefined))).toBe(false);
  });

  it("asks nothing when there is no active tab", async () => {
    const port = tabs({ hidden: true });
    port.query = vi.fn(async () => [{}]);
    expect(await isPanelHiddenOnActiveTab(port)).toBe(false);
    expect(port.sendMessage).not.toHaveBeenCalled();
  });
});

describe("bringing the panel back", () => {
  it("asks the active tab to redraw and reports whether it did", async () => {
    const port = tabs({ reopened: true });
    expect(await showPanelOnActiveTab(port)).toBe(true);
    expect(port.sendMessage).toHaveBeenCalledWith(7, { type: PANEL_REOPEN });
  });

  it("reports failure quietly", async () => {
    const port = tabs(null);
    port.sendMessage.mockRejectedValue(new Error("gone"));
    expect(await showPanelOnActiveTab(port)).toBe(false);
  });
});

describe("the keyboard shortcut", () => {
  it("brings the panel back on the active tab", async () => {
    const port = tabs({ reopened: true });
    expect(await answerCommand(SHOW_PANEL_COMMAND, port)).toBe(true);
    expect(port.sendMessage).toHaveBeenCalledWith(7, { type: PANEL_REOPEN });
  });

  it("ignores a command it does not own", async () => {
    const port = tabs({ reopened: true });
    expect(await answerCommand("something-else", port)).toBe(false);
    expect(port.sendMessage).not.toHaveBeenCalled();
  });
});
