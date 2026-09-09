import { browser } from "wxt/browser";
import { announcePresence } from "../presence/beacon";

export default defineContentScript({
  matches: ["https://verdict.tools/*", "http://localhost/*"],
  runAt: "document_start",
  main() {
    announcePresence(document.documentElement, {
      version: browser.runtime.getManifest().version,
      extensionId: browser.runtime.id,
    });
  },
});
