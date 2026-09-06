import type { ReportOutcome } from "../score/buildReport";

// SPEC.md section 11: "the site can request an analysis of a pasted
// product url, and the extension performs the fetch in the user's own
// session and returns the report." The one place in the codebase that
// already knows how to do exactly that is amazon.content.ts, which runs
// on every amazon page load with the user's real session. Rather than a
// second, parallel extraction path in the background service worker
// (which has no DOM, so no DOMParser, so no way to run
// extract/reviewExtraction.ts's selectors or embedded-json lookups at
// all), this opens the url in a background tab, lets that content script
// run exactly as it always does, and relays its result back over
// contentScript/internalMessages.ts. createTab and removeTab need no
// manifest permission: chrome.tabs.create/remove work unconditionally,
// only reading a tab's own url or title back out needs "tabs" or a host
// permission, and this only ever reads the created tab's id.

export type TabRelayOutcome =
  | ReportOutcome
  | { status: "not-a-product-page" }
  | { status: "timed-out" };

export interface TabRelayDeps {
  createTab: (url: string) => Promise<number>;
  removeTab: (tabId: number) => Promise<void>;
  addResultListener: (listener: (tabId: number, outcome: ReportOutcome | null) => void) => () => void;
  timeoutMs?: number;
  setTimeoutImpl?: (handler: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
}

const DEFAULT_TIMEOUT_MS = 15_000;

// adapters, not setTimeout/clearTimeout directly: the two disagree on
// the handle type across DOM and node's lib typings, and TabRelayDeps
// deliberately does not care which runtime it is either.
function defaultSetTimeout(handler: () => void, ms: number): unknown {
  return setTimeout(handler, ms);
}
function defaultClearTimeout(handle: unknown): void {
  clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
}

export async function analyzeViaHiddenTab(url: string, deps: TabRelayDeps): Promise<TabRelayOutcome> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const setTimeoutImpl = deps.setTimeoutImpl ?? defaultSetTimeout;
  const clearTimeoutImpl = deps.clearTimeoutImpl ?? defaultClearTimeout;

  const tabId = await deps.createTab(url);

  return new Promise<TabRelayOutcome>((resolve) => {
    let settled = false;

    const finish = (result: TabRelayOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeoutImpl(timer);
      unsubscribe();
      deps.removeTab(tabId).catch(() => {
        // the tab may already be gone (closed by the user, navigated
        // away); either way there is nothing left to clean up.
      });
      resolve(result);
    };

    const unsubscribe = deps.addResultListener((resultTabId, outcome) => {
      if (resultTabId !== tabId) {
        return;
      }
      finish(outcome ?? { status: "not-a-product-page" });
    });

    const timer = setTimeoutImpl(() => finish({ status: "timed-out" }), timeoutMs);
  });
}
