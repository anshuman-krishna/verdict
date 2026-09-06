import { browser } from "wxt/browser";
import { analyzePage, type OrchestratorDeps } from "../contentScript/orchestrator";
import { mountResult } from "../contentScript/mount";
import type { AnalysisResultMessage } from "../contentScript/internalMessages";
import { BUNDLED_AMAZON_RULES } from "../extract/bundledRules";
import {
  REMOTE_RULES_CACHE_KEY,
  REMOTE_RULES_PUBLIC_KEY_JWK,
  REMOTE_RULES_URL,
} from "../extract/remoteRules";
import { loadRules } from "../extract/rulesLoader";
import { enqueueContributionEdges } from "../graph/queue";
import { DEFAULT_REPUTATION_ENDPOINT } from "../reputation/endpoint";
import { REPUTATION_SALT } from "../reputation/salt";
import { BUNDLED_MODEL } from "../score/model";
import { PLACEHOLDER_PRIORS } from "../score/priors";
import { addHistoryEntry } from "../storage/history";
import {
  getGraphContributionEnabled,
  getHistoryEnabled,
  getReputationLookupEnabled,
} from "../storage/settings";
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
    // SPEC.md section 9: fetched at most once a day, cached, signed, and
    // version pinned, with a bundled copy as the floor. loadRules never
    // throws and never blocks on a hung network: any failure, including
    // nothing being deployed at REMOTE_RULES_URL yet, resolves to
    // BUNDLED_AMAZON_RULES, the same rules this page would have used
    // before this call existed.
    const rules = await loadRules({
      url: REMOTE_RULES_URL,
      publicKeyJwk: REMOTE_RULES_PUBLIC_KEY_JWK,
      bundledDefault: BUNDLED_AMAZON_RULES,
      cacheKey: REMOTE_RULES_CACHE_KEY,
    });

    const deps: OrchestratorDeps = {
      rules,
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
      // PRIVACY.md section 5: opt in, off by default, and a separate
      // switch from reputation lookup above. enqueue only ever queues
      // locally; entrypoints/background.ts's alarm is what actually
      // submits a batch once its randomised hold elapses. Same
      // REPUTATION_SALT as the lookup above, deliberately: see that
      // constant's own comment for why the two protocols have to share
      // it rather than each getting their own.
      graphContribution: {
        isEnabled: getGraphContributionEnabled,
        salt: REPUTATION_SALT,
        enqueue: (edges) => enqueueContributionEdges(edges),
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
