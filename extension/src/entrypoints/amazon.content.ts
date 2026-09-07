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
    // never throws: nothing deployed yet resolves to the bundled rules, same as before this existed
    const rules = await loadRules({
      url: REMOTE_RULES_URL,
      publicKeyJwk: REMOTE_RULES_PUBLIC_KEY_JWK,
      bundledDefault: BUNDLED_AMAZON_RULES,
      cacheKey: REMOTE_RULES_CACHE_KEY,
    });

    const deps: OrchestratorDeps = {
      rules,
      // null until a corpus and a trained model exist, so every page resolves to no-model and renders
      // nothing. honest, not a bug
      model: BUNDLED_MODEL,
      priors: PLACEHOLDER_PRIORS,
      isHistoryEnabled: getHistoryEnabled,
      saveHistory: (entry) => addHistoryEntry(entry),
      // opt in, off by default, read per analysis so the toggle takes effect on the next check
      reputation: {
        isEnabled: getReputationLookupEnabled,
        endpoint: DEFAULT_REPUTATION_ENDPOINT,
        salt: REPUTATION_SALT,
      },
      // a separate opt in from reputation above. enqueue only queues; the background alarm submits.
      // the shared salt is deliberate, see REPUTATION_SALT
      graphContribution: {
        isEnabled: getGraphContributionEnabled,
        salt: REPUTATION_SALT,
        enqueue: (edges) => enqueueContributionEdges(edges),
      },
    };

    // SPEC.md section 13: not a product page, or a product page extraction
    // could not even find a title for, both render nothing at all.
    const result = await analyzePage(document, location.href, deps);

    // what bridge/analyzeViaTab.ts waits for, correlated by tab id. sent from every page: a no-op
    // when nothing is listening
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
