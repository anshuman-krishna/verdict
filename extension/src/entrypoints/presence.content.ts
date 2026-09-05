import { browser } from "wxt/browser";
import { announcePresence } from "../presence/beacon";

// scoped to the same two origins as externally_connectable in
// wxt.config.ts, and only those: this never runs on a storefront page.
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
