export const PRESENCE_EVENT = "verdict:installed";

export interface PresenceDetail {
  version: string;
  extensionId: string;
}

export function announcePresence(root: HTMLElement, detail: PresenceDetail): void {
  root.dataset.verdictInstalled = "true";
  root.dataset.verdictVersion = detail.version;
  root.dataset.verdictExtensionId = detail.extensionId;
  root.dispatchEvent(new CustomEvent<PresenceDetail>(PRESENCE_EVENT, { detail }));
}
