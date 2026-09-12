import { browser } from "wxt/browser";
import type { ReportOutcome } from "../score/buildReport";
import { analyzeViaHiddenTab } from "../bridge/analyzeViaTab";
import { handleBridgeMessage } from "../bridge/handler";
import { BridgeRateLimiter } from "../bridge/rateLimit";
import { BUNDLED_RULES } from "../extract/bundledRules";
import {
  loadRulesForEverySite,
  trustedRulesForEverySite,
  trustedRulesForSite,
} from "../extract/rulesLoader";
import { isAnalysisResultMessage } from "../contentScript/internalMessages";
import { DEFAULT_GRAPH_CONTRIBUTION_ENDPOINT } from "../graph/endpoint";
import { flushDueContributions } from "../graph/submit";
import { pruneExpiredReviewsCache } from "../storage/reviewsCache";
import { PRIVACY_POLICY_VERSION } from "../privacy/commitments";
import { UNINSTALL_URL } from "../siteLinks";
import { setAcknowledgedPolicyVersion } from "../storage/settings";
import { serveStorageRequest } from "../storage/serveStorage";
import { badgeForOutcome } from "../ui/badge";

type ResultListener = (tabId: number, outcome: ReportOutcome | null) => void;
const resultListeners = new Set<ResultListener>();

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isAnalysisResultMessage(message) && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    for (const listener of resultListeners) {
      listener(tabId, message.outcome);
    }
    return undefined;
  }
  // the storefront page shares its storage with our content script, so the writing happens here
  serveStorageRequest(message, sender, { rules: (siteId) => trustedRulesForSite(siteId) }).then(
    sendResponse,
  );
  return true;
});

function addResultListener(listener: ResultListener): () => void {
  resultListeners.add(listener);
  return () => resultListeners.delete(listener);
}

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
const CONTRIBUTION_ALARM_PERIOD_MINUTES = 30;

const RETENTION_ALARM_NAME = "verdict:prune-reviews-cache";
const RETENTION_ALARM_PERIOD_MINUTES = 6 * 60;

// off the page's critical path, and with no storefront referrer attached
const RULES_ALARM_NAME = "verdict:refresh-rules";
// ticks twice a day so an expired document is picked up promptly, fetches once
const RULES_ALARM_PERIOD_MINUTES = 12 * 60;

const rateLimiter = new BridgeRateLimiter();

export default defineBackground(() => {
  browser.runtime.setUninstallURL?.(UNINSTALL_URL);

  browser.runtime.onInstalled.addListener((details) => {
    // an update leaves it alone, so whatever changed since shows up as pending
    if (details.reason === "install") {
      setAcknowledgedPolicyVersion(PRIVACY_POLICY_VERSION).catch(() => {});
    }
  });

  browser.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    // what this build can read right now, not only what it shipped with
    trustedRulesForEverySite().catch(() => BUNDLED_RULES).then((rules) =>
      handleBridgeMessage(message, {
        bundledRules: rules,
        analyzeUrl,
        rateLimiter,
        origin: senderOrigin(sender),
      })
    ).then(sendResponse);
    return true;
  });

  browser.alarms.create(CONTRIBUTION_ALARM_NAME, {
    periodInMinutes: CONTRIBUTION_ALARM_PERIOD_MINUTES,
  });
  browser.alarms.create(RETENTION_ALARM_NAME, {
    periodInMinutes: RETENTION_ALARM_PERIOD_MINUTES,
  });
  browser.alarms.create(RULES_ALARM_NAME, {
    periodInMinutes: RULES_ALARM_PERIOD_MINUTES,
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CONTRIBUTION_ALARM_NAME) {
      flushDueContributions({ endpoint: DEFAULT_GRAPH_CONTRIBUTION_ENDPOINT }).catch(() => {});
      return;
    }
    if (alarm.name === RETENTION_ALARM_NAME) {
      pruneExpiredReviewsCache().catch(() => {});
      return;
    }
    if (alarm.name === RULES_ALARM_NAME) {
      loadRulesForEverySite().catch(() => {});
    }
  });

  // a browser that was closed for a week sweeps on the way back up
  pruneExpiredReviewsCache().catch(() => {});
  // a service worker wakes far more often than rules change, so the ttl decides
  loadRulesForEverySite().catch(() => {});

  // one glance at the toolbar, no need to open the popup
  addResultListener((tabId, outcome) => {
    const badge = badgeForOutcome(outcome);
    browser.action.setBadgeText({ tabId, text: badge.text }).catch(() => {});
    browser.action.setBadgeBackgroundColor({ tabId, color: badge.color }).catch(() => {});
  });
});
