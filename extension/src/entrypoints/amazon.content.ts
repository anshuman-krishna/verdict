import { browser } from "wxt/browser";
import { analyzePage, type OrchestratorDeps } from "../contentScript/orchestrator";
import { mountResult } from "../contentScript/mount";
import type { AnalysisResultMessage } from "../contentScript/internalMessages";
import { BUNDLED_AMAZON_RULES } from "../extract/bundledRules";
import { DEFAULT_REPUTATION_ENDPOINT } from "../reputation/endpoint";
import { REPUTATION_SALT } from "../reputation/salt";
import { BUNDLED_MODEL } from "../score/model";
import { PLACEHOLDER_PRIORS } from "../score/priors";
import { addHistoryEntry } from "../storage/history";
import { getHistoryEnabled, getReputationLookupEnabled } from "../storage/settings";
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
      // SPEC.md section 4: opt in, off by default (getReputationLookupEnabled's
      // own default). Checked fresh per analysis, not baked in here, so
      // the options page toggle takes effect on the next check.
      reputation: {
        isEnabled: getReputationLookupEnabled,
        endpoint: DEFAULT_REPUTATION_ENDPOINT,
        salt: REPUTATION_SALT,
      },
    };

    // SPEC.md section 13: not a product page, or a product page extraction
    // could not even find a title for, both render nothing at all.
    const result = await analyzePage(document, location.href, deps);

    // bridge/analyzeViaTab.ts opens a background tab for a url pasted on
    // the website's /check page and waits for exactly this message,
    // correlated by tab id, to answer it (SPEC.md section 11). Sent
    // unconditionally, on every page this content script ever runs on,
    // not only ones opened by that relay: nothing is listening for it the
    // rest of the time, so it is a harmless no-op then.
    const message: AnalysisResultMessage = {
      type: "verdict:analysis-result",
      outcome: result?.outcome ?? null,
    };
    browser.runtime.sendMessage(message).catch(() => {
      // no receiver (a normal page visit, not an analyze relay) throws in
      // some browsers; that is the expected, common case, not a failure.
    });

    if (result === null) {
      return;
    }

    mountResult(document, result, deps);
  },
});
