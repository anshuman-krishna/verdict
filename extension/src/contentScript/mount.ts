import { browser } from "wxt/browser";
import { DEFAULT_MAX_PAGES, type FetchProgress } from "../extract/fetchReviewPages";
import type { Report } from "../score/report";
import { rosetteInputFromReport } from "../ui/rosetteInputFromReport";
import type { VerdictNoticeElement } from "../ui/notice";
import type { VerdictPanelElement } from "../ui/panel";
import {
  checkMoreDeeply,
  type AnalysisResult,
  type CheckMoreDeeplyOptions,
  type OrchestratorDeps,
} from "./orchestrator";

function pinToCorner(element: HTMLElement): void {
  element.style.position = "fixed";
  element.style.bottom = "16px";
  element.style.right = "16px";
  element.style.zIndex = "2147483647";
}

function defaultOpenTab(url: string): void {
  window.open(url, "_blank");
}

function createPanel(
  document: Document,
  openTab: (url: string) => void,
  onClose: () => void,
): VerdictPanelElement {
  const panel = document.createElement("verdict-panel") as VerdictPanelElement;
  pinToCorner(panel);
  document.body.appendChild(panel);
  panel.addEventListener("verdict:close", () => {
    panel.remove();
    onClose();
  });
  panel.addEventListener("verdict:full-report", () => {
    openTab(browser.runtime.getURL("/popup.html"));
  });
  return panel;
}

function mountPanel(document: Document, report: Report, openTab: (url: string) => void): void {
  const panel = createPanel(document, openTab, () => {});
  panel.render(report, rosetteInputFromReport(report));
}

function mountNotEnoughDataNotice(
  document: Document,
  result: AnalysisResult,
  deps: OrchestratorDeps,
  checkOptions: CheckMoreDeeplyOptions,
  openTab: (url: string) => void,
): void {
  const notice = document.createElement("verdict-notice") as VerdictNoticeElement;
  pinToCorner(notice);
  document.body.appendChild(notice);
  notice.addEventListener("verdict:close", () => notice.remove());

  const maxPages = checkOptions.maxPages ?? DEFAULT_MAX_PAGES;

  const renderIdle = (): void => {
    notice.render({
      message: "Not enough data to judge yet.",
      action: {
        label: "check more deeply",
        pendingLabel: "checking more deeply...",
        onClick: () => void runCheck(),
      },
    });
  };

  const runCheck = async (): Promise<void> => {
    notice.render({
      message: "Not enough data to judge yet.",
      busy: true,
      action: { label: "check more deeply", pendingLabel: "checking more deeply...", onClick: () => {} },
      progress: startingProgressLine(maxPages),
    });
    try {
      const next = await checkMoreDeeply(result.page, result.product, result.reviews, deps, {
        ...checkOptions,
        onProgress: (progress) => notice.updateProgress(progressLine(progress)),
      });
      notice.remove();
      mountResult(document, next, deps, checkOptions, openTab);
    } catch {
      renderIdle();
    }
  };

  renderIdle();
}

function startingProgressLine(maxPages: number): string {
  return `Reading up to ${maxPages} more pages of reviews.`;
}

function progressLine(progress: FetchProgress): string {
  const reviews = progress.reviewCount === 1 ? "1 review" : `${progress.reviewCount} reviews`;
  return `${progress.pagesFetched} of ${progress.maxPages} pages read, ${reviews} so far.`;
}

export function mountResult(
  document: Document,
  result: AnalysisResult,
  deps: OrchestratorDeps,
  checkOptions: CheckMoreDeeplyOptions = {},
  openTab: (url: string) => void = defaultOpenTab,
): void {
  if (result.outcome.status === "ok") {
    mountPanel(document, result.outcome.report, openTab);
    return;
  }
  if (result.outcome.status === "not-enough-data") {
    mountNotEnoughDataNotice(document, result, deps, checkOptions, openTab);
  }
}

export interface ProgressiveMount {
  waiting: () => void;
  show: (result: AnalysisResult, pending: readonly string[]) => void;
  settle: () => void;
}

export function createProgressiveMount(
  document: Document,
  deps: OrchestratorDeps,
  checkOptions: CheckMoreDeeplyOptions = {},
  openTab: (url: string) => void = defaultOpenTab,
): ProgressiveMount {
  let panel: VerdictPanelElement | null = null;
  let waitingNotice: VerdictNoticeElement | null = null;
  let dismissed = false;
  let shown: AnalysisResult | null = null;

  const clearWaiting = (): void => {
    waitingNotice?.remove();
    waitingNotice = null;
  };

  const mounted: ProgressiveMount = {
    waiting: () => {
      if (dismissed || panel !== null || waitingNotice !== null) {
        return;
      }
      const notice = document.createElement("verdict-notice") as VerdictNoticeElement;
      pinToCorner(notice);
      document.body.appendChild(notice);
      notice.addEventListener("verdict:close", () => {
        dismissed = true;
        clearWaiting();
      });
      notice.render({ message: "Reading the reviews on this page.", busy: true });
      waitingNotice = notice;
    },

    settle: () => {
      if (shown !== null) {
        mounted.show(shown, []);
      }
      clearWaiting();
    },

    show: (result, pending) => {
      // a closed panel stays closed
      if (dismissed) {
        return;
      }
      shown = result;
      if (result.outcome.status === "ok") {
        clearWaiting();
        panel ??= createPanel(document, openTab, () => {
          dismissed = true;
          panel = null;
        });
        panel.render(result.outcome.report, rosetteInputFromReport(result.outcome.report), Date.now(), {
          pending,
        });
        return;
      }
      if (pending.length > 0) {
        return;
      }
      clearWaiting();
      if (result.outcome.status === "not-enough-data") {
        mountNotEnoughDataNotice(document, result, deps, checkOptions, openTab);
      }
    },
  };
  return mounted;
}
