import { browser } from "wxt/browser";
import { analyzePage, type OrchestratorDeps } from "../contentScript/orchestrator";
import { createProgressiveMount } from "../contentScript/mount";
import { callIfSlower, FIRST_PAINT_BUDGET_MS } from "../contentScript/deadline";
import type { AnalysisResultMessage } from "../contentScript/internalMessages";
import { BUNDLED_AMAZON_RULES } from "../extract/bundledRules";
import { contentScriptMatches } from "../extract/sites";
import { DEFAULT_REPUTATION_ENDPOINT } from "../reputation/endpoint";
import { REPUTATION_SALT } from "../reputation/salt";
import { BUNDLED_MODEL } from "../score/model";
import { PLACEHOLDER_PRIORS } from "../score/priors";
import {
  queueContributionEdges,
  readRules,
  readSettings,
  reviewsCacheVia,
  saveHistoryEntry,
} from "../storage/viaBackground";
import "../ui/panel";
import "../ui/notice";

const CONTENT_SCRIPT_MATCHES = contentScriptMatches();

export default defineContentScript({
  matches: CONTENT_SCRIPT_MATCHES,
  runAt: "document_idle",
  async main() {
    // everything stored lives in the extension, never in the storefront's own origin
    const rules = await readRules(BUNDLED_AMAZON_RULES);

    const deps: OrchestratorDeps = {
      rules,
      model: BUNDLED_MODEL,
      priors: PLACEHOLDER_PRIORS,
      isHistoryEnabled: async () => (await readSettings()).historyEnabled,
      saveHistory: (entry) => saveHistoryEntry(entry),
      reputation: {
        isEnabled: async () => (await readSettings()).reputationLookupEnabled,
        endpoint: DEFAULT_REPUTATION_ENDPOINT,
        salt: REPUTATION_SALT,
      },
      graphContribution: {
        isEnabled: async () => (await readSettings()).graphContributionEnabled,
        salt: REPUTATION_SALT,
        enqueue: async (edges) => {
          await queueContributionEdges(edges);
        },
      },
    };

    const checkOptions = { cache: reviewsCacheVia() };
    const mount = createProgressiveMount(document, deps, checkOptions);
    let finish = (): void => {};
    const settled = new Promise<void>((resolve) => {
      finish = resolve;
    });

    let result;
    try {
      result = await analyzePage(document, location.href, deps, {
        // armed only for product pages
        onRecognised: () => callIfSlower(settled, FIRST_PAINT_BUDGET_MS, mount.waiting),
        onStage: (stage) => mount.show(stage.result, stage.pending),
      });
    } catch {
      mount.settle();
    } finally {
      finish();
    }

    const message: AnalysisResultMessage = {
      type: "verdict:analysis-result",
      outcome: result?.outcome ?? null,
    };
    browser.runtime.sendMessage(message).catch(() => {
    });
  },
});
