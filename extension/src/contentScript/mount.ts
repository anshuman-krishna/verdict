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

// DESIGN.md wants this below the star rating, which needs a selector the fixture corpus has not
// verified yet. a corner overlay until then, rather than a guess at amazon's dom
function pinToCorner(element: HTMLElement): void {
  element.style.position = "fixed";
  element.style.bottom = "16px";
  element.style.right = "16px";
  element.style.zIndex = "2147483647";
}

function defaultOpenTab(url: string): void {
  window.open(url, "_blank");
}

// the popup's history holds this report already; there is no per-report page for a server to key on
function mountPanel(document: Document, report: Report, openTab: (url: string) => void): void {
  const panel = document.createElement("verdict-panel") as VerdictPanelElement;
  pinToCorner(panel);
  document.body.appendChild(panel);
  panel.render(report, rosetteInputFromReport(report));
  panel.addEventListener("verdict:close", () => panel.remove());
  panel.addEventListener("verdict:full-report", () => {
    openTab(browser.runtime.getURL("/popup.html"));
  });
}

// SPEC.md section 13. the one action offered is the only thing that can resolve this state
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
      // degrades silently, leaving the action available to retry
      renderIdle();
    }
  };

  renderIdle();
}

// replaced by a real count as soon as the first page lands, before the 800ms gap allows a second
function startingProgressLine(maxPages: number): string {
  return `Reading up to ${maxPages} more pages of reviews.`;
}

function progressLine(progress: FetchProgress): string {
  const reviews = progress.reviewCount === 1 ? "1 review" : `${progress.reviewCount} reviews`;
  return `${progress.pagesFetched} of ${progress.maxPages} pages read, ${reviews} so far.`;
}

// missing-features and no-model render nothing: SPEC.md specifies no copy for either, and the
// wording is not ours to invent
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
