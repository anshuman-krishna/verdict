export const PANEL_STATUS = "verdict:panel:status";
export const PANEL_REOPEN = "verdict:panel:reopen";

export type PanelRequest = { type: typeof PANEL_STATUS } | { type: typeof PANEL_REOPEN };
export type PanelResponse = { hidden: boolean } | { reopened: boolean };

export interface PanelControls {
  hasReading: () => boolean;
  isShowing: () => boolean;
  reopen: () => boolean;
}

export function isPanelRequest(value: unknown): value is PanelRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const type = (value as Record<string, unknown>).type;
  return type === PANEL_STATUS || type === PANEL_REOPEN;
}

export function answerPanelRequest(request: PanelRequest, panel: PanelControls): PanelResponse {
  const hidden = panel.hasReading() && !panel.isShowing();
  if (request.type === PANEL_STATUS) {
    return { hidden };
  }
  return { reopened: hidden && panel.reopen() };
}
