import { analyzePage } from "../contentScript/orchestrator";
import { BUNDLED_AMAZON_RULES } from "../extract/bundledRules";
import { BUNDLED_MODEL } from "../score/model";
import { PLACEHOLDER_PRIORS } from "../score/priors";
import type { Report } from "../score/report";
import { addHistoryEntry } from "../storage/history";
import { getHistoryEnabled } from "../storage/settings";
import { rosetteInputFromReport } from "../ui/rosetteInputFromReport";
import "../ui/panel";
import type { VerdictPanelElement } from "../ui/panel";

// SPEC.md section 9's four locales, matching productPage.ts's LOCALE_BY_HOST.
export default defineContentScript({
  matches: [
    "https://www.amazon.com/*",
    "https://www.amazon.fr/*",
    "https://www.amazon.de/*",
    "https://www.amazon.co.uk/*",
  ],
  runAt: "document_idle",
  async main() {
    const result = await analyzePage(document, location.href, {
      rules: BUNDLED_AMAZON_RULES,
      // both null until PLAN.md weeks 4 and 5 land the ground truth corpus
      // and a trained model.json. Until then every product page here
      // resolves to "no-model" and mountPanel below is never reached,
      // which is the honest behaviour, not a bug: SPEC.md non negotiable
      // 5, never confident on thin data, applies to "no model" exactly as
      // much as it does to too few reviews.
      model: BUNDLED_MODEL,
      priors: PLACEHOLDER_PRIORS,
      isHistoryEnabled: getHistoryEnabled,
      saveHistory: (entry) => addHistoryEntry(entry),
    });

    // SPEC.md section 13: not a product page, or a product page extraction
    // could not even find a title for, both render nothing at all. Every
    // other outcome status (not-enough-data, missing-features, no-model)
    // also renders nothing for now: SPEC.md's "not enough data to judge"
    // messaging for those states is a real gap, not yet built, tracked
    // separately from this wiring.
    if (result === null || result.outcome.status !== "ok") {
      return;
    }

    mountPanel(result.outcome.report);
  },
});

function mountPanel(report: Report): void {
  const panel = document.createElement("verdict-panel") as VerdictPanelElement;
  // DESIGN.md section 6 mocks the panel "injected below the star rating".
  // Locating that element needs a real amazon selector, which needs the
  // fixture corpus (PLAN.md week 1 task 2, not built yet) to verify
  // against rather than guess at. A fixed corner overlay is a safe,
  // honest placeholder that does not depend on guessing amazon's DOM, and
  // is meant to be replaced once that selector exists.
  panel.style.position = "fixed";
  panel.style.bottom = "16px";
  panel.style.right = "16px";
  panel.style.zIndex = "2147483647";
  document.body.appendChild(panel);
  panel.render(report, rosetteInputFromReport(report));
  panel.addEventListener("verdict:close", () => panel.remove());
}
