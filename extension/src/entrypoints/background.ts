import { browser } from "wxt/browser";
import type { ReportOutcome } from "../score/buildReport";
import { analyzeViaHiddenTab } from "../bridge/analyzeViaTab";
import { handleBridgeMessage } from "../bridge/handler";
import { BridgeRateLimiter } from "../bridge/rateLimit";
import { BUNDLED_AMAZON_RULES } from "../extract/bundledRules";
import { isAnalysisResultMessage } from "../contentScript/internalMessages";
import { DEFAULT_GRAPH_CONTRIBUTION_ENDPOINT } from "../graph/endpoint";
import { flushDueContributions } from "../graph/submit";

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

// chrome sets sender.origin; firefox has historically only set sender.url,
// so this falls back to the origin of that url rather than treating a
// firefox sender as anonymous and refusing every message.
function senderOrigin(sender: { origin?: string; url?: string }): string | undefined {
  if (sender.origin !== undefined && sender.origin !== "") {
    return sender.origin;
  }
  if (sender.url === undefined) {
    return undefined;
  }
  try {
    return new URL(sender.url).origin;
  } catch {
    return undefined;
  }
}

const CONTRIBUTION_ALARM_NAME = "verdict:flush-graph-contributions";
// how often this checks the queue, not PRIVACY.md section 5's 1-6 hour
// hold itself (graph/queue.ts enforces that independently, per edge): an
// edge only ever leaves once one of these checks lands after its own
// readyAt has passed. chrome.alarms rather than setTimeout/setInterval
// because MV3 service workers are killed and restarted freely, and a
// plain in memory timer does not survive that; an alarm does.
const CONTRIBUTION_ALARM_PERIOD_MINUTES = 30;

// SPEC.md section 11. externally_connectable in wxt.config.ts already
// scopes who can even reach this listener to the production site and
// localhost, so the origin here is only ever one of those. It still has to
// be read, because PRIVACY.md section 7's rate limit is per origin, and
// because "the site is allowed to ask" is not the same as "the site is
// allowed to ask without limit".
//
// One limiter for the life of the service worker. MV3 kills that worker
// after about thirty seconds idle, so the window resets on a restart; that
// forgives an earlier burst rather than blocking anyone, and the sustained
// load a restart cycle allows is still far below what a person produces.
const rateLimiter = new BridgeRateLimiter();

// PRIVACY.md section 6: "uninstalling the extension deletes it, and the
// uninstall flow says so, since people lose data that way and it is
// avoidable with one sentence." The browser opens this page on uninstall,
// which is the only moment the browser gives us to say it.
//
// No query string, no identifier, no build or version parameter. The page
// therefore learns that somebody uninstalled and nothing else, which is the
// least this can be while still saying the sentence at all. Removing the
// line removes the request; nothing else depends on it.
const UNINSTALL_URL = "https://verdict.tools/uninstalled";

export default defineBackground(() => {
  // not available in every runtime this bundle can load into, so a missing
  // api is a skipped notice rather than a background script that fails to
  // install its message listeners below.
  browser.runtime.setUninstallURL?.(UNINSTALL_URL);

  browser.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    handleBridgeMessage(message, {
      bundledRules: BUNDLED_AMAZON_RULES,
      analyzeUrl,
      rateLimiter,
      origin: senderOrigin(sender),
    }).then(sendResponse);
    return true;
  });

  browser.alarms.create(CONTRIBUTION_ALARM_NAME, {
    periodInMinutes: CONTRIBUTION_ALARM_PERIOD_MINUTES,
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== CONTRIBUTION_ALARM_NAME) {
      return;
    }
    // flushDueContributions never throws (graph/submit.ts): a network or
    // service failure just leaves the batch queued for the next alarm.
    // This catch only guards against something truly unexpected, so a
    // bug here cannot take the rest of the background script down with
    // it.
    flushDueContributions({ endpoint: DEFAULT_GRAPH_CONTRIBUTION_ENDPOINT }).catch(() => {});
  });
});
