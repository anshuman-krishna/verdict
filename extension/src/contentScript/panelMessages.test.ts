import { describe, expect, it, vi } from "vitest";
import { answerPanelRequest, isPanelRequest, PANEL_REOPEN, PANEL_STATUS } from "./panelMessages";

function panelOf(hasReading: boolean, showing: boolean) {
  return { hasReading: () => hasReading, isShowing: () => showing, reopen: vi.fn(() => hasReading) };
}

describe("which messages the panel answers", () => {
  it("takes the two it knows", () => {
    expect(isPanelRequest({ type: PANEL_STATUS })).toBe(true);
    expect(isPanelRequest({ type: PANEL_REOPEN })).toBe(true);
  });

  it("leaves everything else for somebody else", () => {
    for (const message of [null, "verdict:panel:reopen", {}, { type: "verdict:analysis-result" }]) {
      expect(isPanelRequest(message)).toBe(false);
    }
  });
});

describe("answering the popup", () => {
  it("says a closed reading can come back", () => {
    expect(answerPanelRequest({ type: PANEL_STATUS }, panelOf(true, false))).toEqual({ hidden: true });
  });

  it("offers nothing while the panel is already on screen, or when nothing was read", () => {
    expect(answerPanelRequest({ type: PANEL_STATUS }, panelOf(true, true))).toEqual({ hidden: false });
    expect(answerPanelRequest({ type: PANEL_STATUS }, panelOf(false, false))).toEqual({ hidden: false });
  });

  it("redraws on request and says whether it could", () => {
    const panel = panelOf(true, false);
    expect(answerPanelRequest({ type: PANEL_REOPEN }, panel)).toEqual({ reopened: true });
    expect(panel.reopen).toHaveBeenCalledOnce();
  });

  it("does not stack a second panel on one already showing", () => {
    const panel = panelOf(true, true);
    expect(answerPanelRequest({ type: PANEL_REOPEN }, panel)).toEqual({ reopened: false });
    expect(panel.reopen).not.toHaveBeenCalled();
  });
});
