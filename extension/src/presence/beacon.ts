// SPEC.md section 11 describes the bridge (externally_connectable) but
// not how the website learns the extension exists at all, or which
// extension id to send messages to: there is no fixed id before this
// ships to a store. a content script running only on the site's own
// domain, set at document_start so it lands before the page's own
// scripts run, answers both questions without the website ever guessing
// an id or polling for one.

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
