import { browser } from "wxt/browser";
import { SITE_MATCHES } from "../bridge/origins";
import { installRelay, RELAY_ATTRIBUTE } from "../bridge/relay";
import { announcePresence } from "../presence/beacon";

export default defineContentScript({
  matches: [...SITE_MATCHES],
  runAt: "document_start",
  main() {
    installRelay(window, (message) => browser.runtime.sendMessage(message));
    // listen before announcing presence
    document.documentElement.setAttribute(RELAY_ATTRIBUTE, "true");
    announcePresence(document.documentElement, {
      version: browser.runtime.getManifest().version,
      extensionId: browser.runtime.id,
    });
  },
});
