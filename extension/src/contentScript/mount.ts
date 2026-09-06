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

// DESIGN.md section 6 mocks the panel "injected below the star rating".
// Locating that element needs a real amazon selector, which needs the
// fixture corpus (PLAN.md week 1 task 2, not built yet) to verify against
// rather than guess at. A fixed corner overlay is a safe, honest
// placeholder that does not depend on guessing amazon's DOM, and is meant
// to be replaced once that selector exists. Shared by the panel and the
// notice so both anchor to the same spot.
function pinToCorner(element: HTMLElement): void {
  element.style.position = "fixed";
  element.style.bottom = "16px";
  element.style.right = "16px";
  element.style.zIndex = "2147483647";
}

function mountPanel(document: Document, report: Report): void {
  const panel = document.createElement("verdict-panel") as VerdictPanelElement;
  pinToCorner(panel);
  document.body.appendChild(panel);
  panel.render(report, rosetteInputFromReport(report));
  panel.addEventListener("verdict:close", () => panel.remove());
}

// SPEC.md section 13: "extraction yields under 30 reviews: 'not enough
// data to judge', no score, no error styling." The one action available
// from here is SPEC.md section 9's explicit, user triggered review fetch,
// which is the only thing that can actually resolve this state.
function mountNotEnoughDataNotice(
  document: Document,
  result: AnalysisResult,
  deps: OrchestratorDeps,
  checkOptions: CheckMoreDeeplyOptions,
): void {
  const notice = document.createElement("verdict-notice") as VerdictNoticeElement;
  pinToCorner(notice);
  document.body.appendChild(notice);
  notice.addEventListener("verdict:close", () => notice.remove());

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
    });
    try {
      const next = await checkMoreDeeply(result.page, result.product, result.reviews, deps, checkOptions);
      notice.remove();
      mountResult(document, next, deps, checkOptions);
    } catch {
      // SPEC.md section 13's pattern throughout: a failure degrades
      // silently rather than surfacing an error state, so the user is
      // simply left with the action still available to retry.
      renderIdle();
    }
  };

  renderIdle();
}

// the one place that turns a ReportOutcome into something on the page.
// missing-features and no-model render nothing: SPEC.md section 13 does
// not specify copy for either (a production model.json, once one exists,
// is not expected to ever be missing a feature it was trained needing;
// no-model cannot happen once a model is bundled), so this stays silent
// rather than inventing user facing wording CLAUDE.md reserves.
export function mountResult(
  document: Document,
  result: AnalysisResult,
  deps: OrchestratorDeps,
  checkOptions: CheckMoreDeeplyOptions = {},
): void {
  if (result.outcome.status === "ok") {
    mountPanel(document, result.outcome.report);
    return;
  }
  if (result.outcome.status === "not-enough-data") {
    mountNotEnoughDataNotice(document, result, deps, checkOptions);
  }
}
