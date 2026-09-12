import { browser } from "wxt/browser";
import { analyzePage, type OrchestratorDeps } from "../contentScript/orchestrator";
import { createProgressiveMount, removeMountedElements } from "../contentScript/mount";
import { callIfSlower, FIRST_PAINT_BUDGET_MS } from "../contentScript/deadline";
import { browserUrlWatcher } from "../contentScript/navigation";
import { createSession } from "../contentScript/session";
import type { AnalysisResultMessage } from "../contentScript/internalMessages";
import { bundledRulesFor, emptyRules } from "../extract/bundledRules";
import { contentScriptMatches, siteForHost } from "../extract/sites";
import { DEFAULT_REPUTATION_ENDPOINT } from "../reputation/endpoint";
import { REPUTATION_SALT } from "../reputation/salt";
import { BUNDLED_MODEL, BUNDLED_MODEL_IDENTITY } from "../score/model";
import { PLACEHOLDER_PRIORS } from "../score/priors";
import {
  queueContributionEdges,
  readChecksOfProduct,
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
    // the host decides which storefront's rules apply, before anything is parsed
    const site = siteForHost(location.hostname);
    if (site === null) {
      return;
    }
    // everything stored lives in the extension, never in the storefront's own origin
    const rules = await readRules(site.id, bundledRulesFor(site.id) ?? emptyRules(site.id));

    const deps: OrchestratorDeps = {
      rules,
      model: BUNDLED_MODEL,
      priors: PLACEHOLDER_PRIORS,
      provenance: {
        extensionVersion: browser.runtime.getManifest().version,
        modelTrainedAt: BUNDLED_MODEL_IDENTITY.trainedAt,
        modelDigest: BUNDLED_MODEL_IDENTITY.digest,
      },
      isHistoryEnabled: async () => (await readSettings()).historyEnabled,
      saveHistory: (entry) => saveHistoryEntry(entry),
      previousChecks: (productKey) => readChecksOfProduct(productKey),
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

    const session = createSession({
      createMount: () => createProgressiveMount(document, deps, checkOptions),
      // a panel describing the listing we just left is worse than no panel
      teardown: () => removeMountedElements(document),
      analyse: async (href, mount) => {
        let finish = (): void => {};
        const settled = new Promise<void>((resolve) => {
          finish = resolve;
        });
        try {
          return await analyzePage(document, href, deps, {
            // armed only for product pages
            onRecognised: () => callIfSlower(settled, FIRST_PAINT_BUDGET_MS, mount.waiting),
            onStage: (stage) => mount.show(stage.result, stage.pending),
          });
        } finally {
          finish();
        }
      },
      report: (outcome) => {
        const message: AnalysisResultMessage = { type: "verdict:analysis-result", outcome };
        browser.runtime.sendMessage(message).catch(() => {
        });
      },
    });

    // the first read needs no settling, document_idle already waited
    await session.visit(location.href, { settleMs: 0 });
    browserUrlWatcher((href) => void session.visit(href));
  },
});
