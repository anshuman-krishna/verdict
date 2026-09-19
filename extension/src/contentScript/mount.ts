import { browser } from "wxt/browser";
import { DEFAULT_MAX_PAGES, NO_REVIEWS_CACHE, type FetchProgress } from "../extract/fetchReviewPages";
import { canFetchReviewPages, reviewPageCap } from "../extract/sites";
import type { ProductSnapshot } from "../extract/types";
import { ENGLISH_TRANSLATOR, type Translator } from "../i18n/translator";
import { signalLabel } from "../score/reportText";
import type { Report } from "../score/report";
import { STATUS_URL } from "../siteLinks";
import { rosetteInputFromReport } from "../ui/rosetteInputFromReport";
import type { NoticeState, VerdictNoticeElement } from "../ui/notice";
import type { FullReportDetail, VerdictPanelElement, WatchDetail } from "../ui/panel";
import type { WatchStatus } from "../storage/watchlist";
import { readingFromReport } from "../watchlist/reading";
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
  onWatch: (watching: boolean) => void = () => {},
): VerdictPanelElement {
  const panel = document.createElement("verdict-panel") as VerdictPanelElement;
  pinToCorner(panel);
  document.body.appendChild(panel);
  panel.addEventListener("verdict:close", () => {
    panel.remove();
    onClose();
  });
  panel.addEventListener("verdict:watch", (event) => {
    const { watching } = (event as CustomEvent<WatchDetail>).detail ?? { watching: false };
    onWatch(watching);
  });
  panel.addEventListener("verdict:full-report", (event) => {
    const { serial } = (event as CustomEvent<FullReportDetail>).detail ?? { serial: "" };
    const suffix = serial === "" ? "" : `#${encodeURIComponent(serial)}`;
    openTab(`${browser.runtime.getURL("/popup.html")}${suffix}`);
  });
  return panel;
}

// the panel asked to save or let go of this listing, so the port answers and the panel redraws
function watchToggler(
  result: AnalysisResult,
  report: Report,
  deps: OrchestratorDeps,
  redraw: (status: WatchStatus) => void,
): (watching: boolean) => void {
  return (watching) => {
    const toggle = deps.watchToggle;
    if (toggle === undefined || result.product === null || result.productKey === undefined) {
      return;
    }
    const featureVector = result.outcome.status === "ok" ? result.outcome.featureVector : undefined;
    void toggle({
      watching,
      productKey: result.productKey,
      site: result.page.site,
      title: result.product.title,
      thumbnailUrl: result.product.thumbnailUrl,
      reading: readingFromReport(report, featureVector),
    }).then(redraw, () => {});
  };
}

function mountPanel(
  document: Document,
  result: AnalysisResult,
  report: Report,
  openTab: (url: string) => void,
  translator: Translator,
  deps?: OrchestratorDeps,
): void {
  let status = result.watch;
  const draw = (): void => {
    panel.render(report, rosetteInputFromReport(report), Date.now(), {
      previousChecks: result.previousChecks,
      watch: status,
      translator,
    });
  };
  const panel = createPanel(
    document,
    openTab,
    () => {},
    deps === undefined ? undefined : watchToggler(result, report, deps, (updated) => {
      status = updated;
      draw();
    }),
  );
  draw();
}

function createNotice(document: Document): VerdictNoticeElement {
  const notice = document.createElement("verdict-notice") as VerdictNoticeElement;
  pinToCorner(notice);
  document.body.appendChild(notice);
  notice.addEventListener("verdict:close", () => notice.remove());
  return notice;
}

// DESIGN.md section 9: an extraction that failed says so, and points somewhere
export function unreadableState(t: Translator = ENGLISH_TRANSLATOR): NoticeState {
  return {
    message: t.text("notice.unreadable"),
    link: { label: t.text("notice.statusLink"), href: STATUS_URL },
  };
}

export function missingSignalsState(
  missing: readonly string[],
  t: Translator = ENGLISH_TRANSLATOR,
): NoticeState {
  const named = missing.map((signal) => signalLabel(signal, t)).join(", ");
  return {
    message: t.text("notice.missingSignals", { signals: named }),
    link: { label: t.text("notice.statusLink"), href: STATUS_URL },
  };
}

export function noModelState(t: Translator = ENGLISH_TRANSLATOR): NoticeState {
  return { message: t.text("notice.noModel") };
}

export function notEnoughReviewsMessage(
  reviewCount: number,
  t: Translator = ENGLISH_TRANSLATOR,
): string {
  return t.text("notice.notEnoughReviews", { reviews: t.count("count.reviews", reviewCount) });
}

// a platform whose reviews only ever arrive with the page has no deeper read to offer
export function pageOnlyMessage(
  result: AnalysisResult,
  t: Translator = ENGLISH_TRANSLATOR,
): string {
  return t.text("notice.pageOnly", {
    reviews: t.count("count.reviews", result.reviews.length),
  });
}

// SPEC.md section 13 would rather say there is nothing more than offer a button that reads nothing
export function everyPageReadMessage(
  result: AnalysisResult,
  t: Translator = ENGLISH_TRANSLATOR,
): string {
  const pagesRead = result.fetch?.pagesFetched ?? 0;
  const reach = result.fetch?.stoppedBecause === "complete"
    ? t.text("notice.reachOwnCeiling")
    : t.text("notice.reachEveryPage");
  return t.text("notice.everyPageRead", {
    reviews: t.count("count.reviews", result.reviews.length),
    pages: t.count("count.pages", pagesRead),
    reach,
  });
}

// SPEC.md section 9: five pages on the first ask, the storefront's own ceiling on the second
export function nextReadDepth(
  result: AnalysisResult,
  checkOptions: CheckMoreDeeplyOptions,
): number | null {
  if (!canFetchReviewPages(result.page.site)) {
    return null;
  }
  const cap = Math.max(reviewPageCap(result.page.site), DEFAULT_MAX_PAGES);
  const read = result.fetch;
  if (read === undefined) {
    return Math.min(checkOptions.maxPages ?? DEFAULT_MAX_PAGES, cap);
  }
  // a run that ran out of pages has nothing deeper to reach for
  if (read.stoppedBecause === "exhausted" || read.stoppedBecause === "repeated") {
    return null;
  }
  // a storefront that stopped answering is worth asking again, at the same depth
  if (read.stoppedBecause === "failed") {
    return read.maxPages;
  }
  return read.maxPages >= cap ? null : cap;
}

function mountPlainNotice(document: Document, state: NoticeState, t: Translator): void {
  createNotice(document).render(state, t);
}

function mountNotEnoughDataNotice(
  document: Document,
  result: AnalysisResult,
  product: ProductSnapshot,
  deps: OrchestratorDeps,
  checkOptions: CheckMoreDeeplyOptions,
  openTab: (url: string) => void,
  t: Translator,
): void {
  const maxPages = nextReadDepth(result, checkOptions);
  if (maxPages === null) {
    const message = canFetchReviewPages(result.page.site)
      ? everyPageReadMessage(result, t)
      : pageOnlyMessage(result, t);
    mountPlainNotice(document, { message }, t);
    return;
  }

  const notice = createNotice(document);
  const message = notEnoughReviewsMessage(result.reviews.length, t);
  const label = t.text("notice.checkMoreDeeply");
  const pendingLabel = t.text("notice.checkingMoreDeeply");

  const renderIdle = (): void => {
    notice.render({
      message,
      action: { label, pendingLabel, onClick: () => void runCheck() },
    }, t);
  };

  const runCheck = async (): Promise<void> => {
    notice.render({
      message,
      busy: true,
      action: { label, pendingLabel, onClick: () => {} },
      progress: startingProgressLine(maxPages, t),
    }, t);
    try {
      const next = await checkMoreDeeply(result.page, product, result.reviews, deps, {
        ...checkOptions,
        maxPages,
        onProgress: (progress) => notice.updateProgress(progressLine(progress, t)),
      });
      notice.remove();
      mountResult(document, next, deps, { ...checkOptions, maxPages }, openTab, t);
    } catch {
      renderIdle();
    }
  };

  renderIdle();
}

export function startingProgressLine(
  maxPages: number,
  t: Translator = ENGLISH_TRANSLATOR,
): string {
  return t.count("notice.readingUpTo", maxPages);
}

export function progressLine(
  progress: FetchProgress,
  t: Translator = ENGLISH_TRANSLATOR,
): string {
  return t.text("notice.progress", {
    read: progress.pagesFetched,
    total: progress.maxPages,
    reviews: t.count("count.reviews", progress.reviewCount),
  });
}

export function mountResult(
  document: Document,
  result: AnalysisResult,
  deps: OrchestratorDeps,
  checkOptions: CheckMoreDeeplyOptions = { cache: NO_REVIEWS_CACHE },
  openTab: (url: string) => void = defaultOpenTab,
  t: Translator = ENGLISH_TRANSLATOR,
): void {
  const outcome = result.outcome;
  if (outcome.status === "ok") {
    mountPanel(document, result, outcome.report, openTab, t, deps);
    return;
  }
  if (outcome.status === "unreadable") {
    mountPlainNotice(document, unreadableState(t), t);
    return;
  }
  if (outcome.status === "missing-features") {
    mountPlainNotice(document, missingSignalsState(outcome.missing, t), t);
    return;
  }
  if (outcome.status === "no-model") {
    mountPlainNotice(document, noModelState(t), t);
    return;
  }
  if (result.product !== null) {
    mountNotEnoughDataNotice(document, result, result.product, deps, checkOptions, openTab, t);
  }
}

// our own tag names, so this cannot miss one and cannot touch anything of the page's
export function removeMountedElements(document: Document): void {
  for (const element of document.querySelectorAll("verdict-panel, verdict-notice")) {
    element.remove();
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
  t: Translator = ENGLISH_TRANSLATOR,
): ProgressiveMount {
  let panel: VerdictPanelElement | null = null;
  let watching: WatchStatus | undefined;
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
      notice.render({ message: t.text("notice.reading"), busy: true }, t);
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
        const report = result.outcome.report;
        const draw = (): void => {
          panel?.render(report, rosetteInputFromReport(report), Date.now(), {
            pending,
            previousChecks: result.previousChecks,
            watch: watching,
            translator: t,
          });
        };
        watching = result.watch ?? watching;
        panel ??= createPanel(
          document,
          openTab,
          () => {
            dismissed = true;
            panel = null;
          },
          watchToggler(result, report, deps, (updated) => {
            watching = updated;
            draw();
          }),
        );
        draw();
        return;
      }
      if (pending.length > 0) {
        return;
      }
      clearWaiting();
      mountResult(document, result, deps, checkOptions, openTab, t);
    },
  };
  return mounted;
}
