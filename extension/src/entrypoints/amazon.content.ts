import { analyzePage, type OrchestratorDeps } from "../contentScript/orchestrator";
import { mountResult } from "../contentScript/mount";
import { BUNDLED_AMAZON_RULES } from "../extract/bundledRules";
import { BUNDLED_MODEL } from "../score/model";
import { PLACEHOLDER_PRIORS } from "../score/priors";
import { addHistoryEntry } from "../storage/history";
import { getHistoryEnabled } from "../storage/settings";
import "../ui/panel";
import "../ui/notice";

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
    const deps: OrchestratorDeps = {
      rules: BUNDLED_AMAZON_RULES,
      // both null until PLAN.md weeks 4 and 5 land the ground truth corpus
      // and a trained model.json. Until then every product page here
      // resolves to "no-model" and mountResult below renders nothing,
      // which is the honest behaviour, not a bug: SPEC.md non negotiable
      // 5, never confident on thin data, applies to "no model" exactly as
      // much as it does to too few reviews.
      model: BUNDLED_MODEL,
      priors: PLACEHOLDER_PRIORS,
      isHistoryEnabled: getHistoryEnabled,
      saveHistory: (entry) => addHistoryEntry(entry),
    };

    // SPEC.md section 13: not a product page, or a product page extraction
    // could not even find a title for, both render nothing at all.
    const result = await analyzePage(document, location.href, deps);
    if (result === null) {
      return;
    }

    mountResult(document, result, deps);
  },
});
