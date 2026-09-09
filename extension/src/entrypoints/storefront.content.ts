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
import { contentScriptMatches } from "../extract/sites";
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

const CONTENT_SCRIPT_MATCHES = contentScriptMatches();

export default defineContentScript({
  matches: CONTENT_SCRIPT_MATCHES,
  runAt: "document_idle",
  async main() {
    const rules = await loadRules({
      url: REMOTE_RULES_URL,
      publicKeyJwk: REMOTE_RULES_PUBLIC_KEY_JWK,
      bundledDefault: BUNDLED_AMAZON_RULES,
      cacheKey: REMOTE_RULES_CACHE_KEY,
    });

    const deps: OrchestratorDeps = {
      rules,
      model: BUNDLED_MODEL,
      priors: PLACEHOLDER_PRIORS,
      isHistoryEnabled: getHistoryEnabled,
      saveHistory: (entry) => addHistoryEntry(entry),
      reputation: {
        isEnabled: getReputationLookupEnabled,
        endpoint: DEFAULT_REPUTATION_ENDPOINT,
        salt: REPUTATION_SALT,
      },
      graphContribution: {
        isEnabled: getGraphContributionEnabled,
        salt: REPUTATION_SALT,
        enqueue: (edges) => enqueueContributionEdges(edges),
      },
    };

    const result = await analyzePage(document, location.href, deps);

    const message: AnalysisResultMessage = {
      type: "verdict:analysis-result",
      outcome: result?.outcome ?? null,
    };
    browser.runtime.sendMessage(message).catch(() => {
    });

    if (result === null) {
      return;
    }

    mountResult(document, result, deps);
  },
});
