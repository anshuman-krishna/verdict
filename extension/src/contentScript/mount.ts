import { browser } from "wxt/browser";
import { DEFAULT_MAX_PAGES, NO_REVIEWS_CACHE, type FetchProgress } from "../extract/fetchReviewPages";
import type { ProductSnapshot } from "../extract/types";
import type { Report } from "../score/report";
import { STATUS_URL } from "../siteLinks";
import { rosetteInputFromReport } from "../ui/rosetteInputFromReport";
import type { NoticeState, VerdictNoticeElement } from "../ui/notice";
import type { FullReportDetail, VerdictPanelElement } from "../ui/panel";
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
  panel.addEventListener("verdict:full-report", (event) => {
    const { serial } = (event as CustomEvent<FullReportDetail>).detail ?? { serial: "" };
    const suffix = serial === "" ? "" : `#${encodeURIComponent(serial)}`;
    openTab(`${browser.runtime.getURL("/popup.html")}${suffix}`);
  });
  return panel;
}

function mountPanel(
  document: Document,
  result: AnalysisResult,
  report: Report,
  openTab: (url: string) => void,
): void {
  const panel = createPanel(document, openTab, () => {});
  panel.render(report, rosetteInputFromReport(report), Date.now(), {
    previousChecks: result.previousChecks,
  });
}

function createNotice(document: Document): VerdictNoticeElement {
  const notice = document.createElement("verdict-notice") as VerdictNoticeElement;
  pinToCorner(notice);
  document.body.appendChild(notice);
  notice.addEventListener("verdict:close", () => notice.remove());
  return notice;
}

// DESIGN.md section 9: an extraction that failed says so, and points somewhere
export function unreadableState(): NoticeState {
  return {
    message: "Verdict could not read this page.",
    link: { label: "extraction status", href: STATUS_URL },
  };
}

export function missingSignalsState(missing: readonly string[]): NoticeState {
  const named = missing.length === 1 ? missing[0] : missing.join(", ");
  return {
    message: `Verdict could not read enough of this page to judge it. Missing: ${named}.`,
    link: { label: "extraction status", href: STATUS_URL },
  };
}

export function noModelState(): NoticeState {
  return { message: "This build of Verdict carries no scoring model, so it cannot judge a page." };
}

export function notEnoughReviewsMessage(reviewCount: number): string {
  const found = reviewCount === 1 ? "1 review" : `${reviewCount.toLocaleString()} reviews`;
  return `Not enough reviews to judge this one. ${found} found.`;
}

function mountPlainNotice(document: Document, state: NoticeState): void {
  createNotice(document).render(state);
}

function mountNotEnoughDataNotice(
  document: Document,
  result: AnalysisResult,
  product: ProductSnapshot,
  deps: OrchestratorDeps,
  checkOptions: CheckMoreDeeplyOptions,
  openTab: (url: string) => void,
): void {
  const notice = createNotice(document);

  const maxPages = checkOptions.maxPages ?? DEFAULT_MAX_PAGES;
  const message = notEnoughReviewsMessage(result.reviews.length);

  const renderIdle = (): void => {
    notice.render({
      message,
      action: {
        label: "check more deeply",
        pendingLabel: "checking more deeply...",
        onClick: () => void runCheck(),
      },
    });
  };

  const runCheck = async (): Promise<void> => {
    notice.render({
      message,
      busy: true,
      action: { label: "check more deeply", pendingLabel: "checking more deeply...", onClick: () => {} },
      progress: startingProgressLine(maxPages),
    });
    try {
      const next = await checkMoreDeeply(result.page, product, result.reviews, deps, {
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
  checkOptions: CheckMoreDeeplyOptions = { cache: NO_REVIEWS_CACHE },
  openTab: (url: string) => void = defaultOpenTab,
): void {
  const outcome = result.outcome;
  if (outcome.status === "ok") {
    mountPanel(document, result, outcome.report, openTab);
    return;
  }
  if (outcome.status === "unreadable") {
    mountPlainNotice(document, unreadableState());
    return;
  }
  if (outcome.status === "missing-features") {
    mountPlainNotice(document, missingSignalsState(outcome.missing));
    return;
  }
  if (outcome.status === "no-model") {
    mountPlainNotice(document, noModelState());
    return;
  }
  if (result.product !== null) {
    mountNotEnoughDataNotice(document, result, result.product, deps, checkOptions, openTab);
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
  checkOptions: CheckMoreDeeplyOptions = { cache: NO_REVIEWS_CACHE },
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
          previousChecks: result.previousChecks,
        });
        return;
      }
      if (pending.length > 0) {
        return;
      }
      clearWaiting();
      mountResult(document, result, deps, checkOptions, openTab);
    },
  };
  return mounted;
}
