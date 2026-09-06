import { browser } from "wxt/browser";
import type { ReportOutcome } from "../score/buildReport";
import { analyzeViaHiddenTab } from "../bridge/analyzeViaTab";
import { handleBridgeMessage } from "../bridge/handler";
import { BUNDLED_AMAZON_RULES } from "../extract/bundledRules";
import { isAnalysisResultMessage } from "../contentScript/internalMessages";

type ResultListener = (tabId: number, outcome: ReportOutcome | null) => void;
const resultListeners = new Set<ResultListener>();

// amazon.content.ts sends this on every page it ever runs on
// (internalMessages.ts), not only ones this background opened itself, so
// this listener always exists rather than being installed only while a
// relay is in flight.
browser.runtime.onMessage.addListener((message, sender) => {
  if (isAnalysisResultMessage(message) && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    for (const listener of resultListeners) {
      listener(tabId, message.outcome);
    }
  }
});

function addResultListener(listener: ResultListener): () => void {
  resultListeners.add(listener);
  return () => resultListeners.delete(listener);
}

// bridge/analyzeViaTab.ts's comment explains why this is a background
// tab rather than a second extraction path here: no DOM exists in a
// service worker to run extract/reviewExtraction.ts's selectors or
// embedded-json lookups against. tabs.create/tabs.remove need no manifest
// permission, since only reading a tab's own url or title back out would.
function analyzeUrl(url: string) {
  return analyzeViaHiddenTab(url, {
    createTab: async (tabUrl) => {
      const tab = await browser.tabs.create({ url: tabUrl, active: false });
      if (tab.id === undefined) {
        throw new Error("browser.tabs.create returned a tab with no id");
      }
      return tab.id;
    },
    removeTab: (tabId) => browser.tabs.remove(tabId),
    addResultListener,
  });
}

// SPEC.md section 11. externally_connectable in wxt.config.ts already
// scopes who can even reach this listener to the production site and
// localhost, so this only has to validate the message shape, not the
// sender's origin.
export default defineBackground(() => {
  browser.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
    handleBridgeMessage(message, { bundledRules: BUNDLED_AMAZON_RULES, analyzeUrl }).then(sendResponse);
    return true;
  });
});
