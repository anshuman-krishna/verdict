import { PANEL_REOPEN, PANEL_STATUS, type PanelRequest } from "./panelMessages";

export interface TabsPort {
  query: (filter: { active: true; currentWindow: true }) => Promise<{ id?: number }[]>;
  sendMessage: (tabId: number, message: PanelRequest) => Promise<unknown>;
}

// an id is all this needs, which the tabs permission is not required for
async function askActiveTab(tabs: TabsPort, request: PanelRequest): Promise<Record<string, unknown> | null> {
  try {
    const [tab] = await tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
      return null;
    }
    const reply = await tabs.sendMessage(tab.id, request);
    return typeof reply === "object" && reply !== null ? reply as Record<string, unknown> : null;
  } catch {
    // any page without our content script refuses the connection
    return null;
  }
}

export async function isPanelHiddenOnActiveTab(tabs: TabsPort): Promise<boolean> {
  return (await askActiveTab(tabs, { type: PANEL_STATUS }))?.hidden === true;
}

export async function showPanelOnActiveTab(tabs: TabsPort): Promise<boolean> {
  return (await askActiveTab(tabs, { type: PANEL_REOPEN }))?.reopened === true;
}

// the manifest declares it under this name, so the two cannot drift apart
export const SHOW_PANEL_COMMAND = "show-panel";

export async function answerCommand(command: string, tabs: TabsPort): Promise<boolean> {
  return command === SHOW_PANEL_COMMAND && await showPanelOnActiveTab(tabs);
}
