import type { ReportOutcome } from "../score/buildReport";


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
