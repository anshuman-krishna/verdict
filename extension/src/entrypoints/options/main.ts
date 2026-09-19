import { browser } from "wxt/browser";
import { siteIdsMatchedBy } from "../../extract/sites";
import { setGraphContributionWithPermission } from "../../graph/permission";
import { setReputationLookupWithPermission } from "../../reputation/permission";
import { clearContributionQueue } from "../../graph/queue";
import { PRIVACY_POLICY_VERSION, pendingPolicyChanges } from "../../privacy/commitments";
import { readHoldings } from "../../storage/holdings";
import { deleteAllWatchlist } from "../../storage/watchlist";
import { deleteAllHistory, exportHistoryAsCsv, exportHistoryAsJson } from "../../storage/history";
import { importHistory, importResultLine } from "../../storage/importHistory";
import { clearReviewsCache } from "../../storage/reviewsCache";
import {
  getAcknowledgedPolicyVersion,
  getAnalysisEnabled,
  getGraphContributionEnabled,
  getHistoryEnabled,
  getPausedSites,
  getReputationLookupEnabled,
  setAcknowledgedPolicyVersion,
  setAnalysisEnabled,
  setHistoryEnabled,
  setSitePaused,
} from "../../storage/settings";
import { platformLabel, renderOptions, type Platform } from "../../ui/optionsPage";

// what this build actually runs on, so a store build never offers a platform it cannot read
function platformsOfThisBuild(paused: readonly string[]): Platform[] {
  const declared = browser.runtime.getManifest().content_scripts ?? [];
  return siteIdsMatchedBy(declared.flatMap((script) => script.matches ?? [])).map((id) => ({
    id,
    label: platformLabel(id),
    paused: paused.includes(id),
  }));
}

function download(filename: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function refresh(importMessage: string | null = null): Promise<void> {
  const app = document.getElementById("app");
  if (app === null) {
    return;
  }
  const analysisEnabled = await getAnalysisEnabled();
  const platforms = platformsOfThisBuild(await getPausedSites());
  const historyEnabled = await getHistoryEnabled();
  const reputationLookupEnabled = await getReputationLookupEnabled();
  const graphContributionEnabled = await getGraphContributionEnabled();
  const holdings = await readHoldings();
  const policyChanges = pendingPolicyChanges(await getAcknowledgedPolicyVersion());
  renderOptions(
    app,
    {
      analysisEnabled,
      platforms,
      historyEnabled,
      reputationLookupEnabled,
      graphContributionEnabled,
      holdings,
      pendingPolicyChanges: policyChanges,
      importMessage,
    },
    {
      onToggleAnalysis: async (enabled) => {
        await setAnalysisEnabled(enabled);
        await refresh();
      },
      onTogglePlatform: async (site, paused) => {
        await setSitePaused(site, paused);
        await refresh();
      },
      onToggleHistory: async (enabled) => {
        await setHistoryEnabled(enabled);
      },
      onToggleReputationLookup: async (enabled) => {
        await setReputationLookupWithPermission(enabled);
        await refresh();
      },
      onToggleGraphContribution: async (enabled) => {
        await setGraphContributionWithPermission(enabled);
        await refresh();
      },
      onExportJson: async () =>
        download("verdict-history.json", await exportHistoryAsJson(), "application/json"),
      onExportCsv: async () =>
        download("verdict-history.csv", await exportHistoryAsCsv(), "text/csv"),
      onDeleteAll: async () => {
        await deleteAllHistory();
        await refresh();
      },
      onClearWatchlist: async () => {
        await deleteAllWatchlist();
        await refresh();
      },
      onClearCache: async () => {
        await clearReviewsCache();
        await refresh();
      },
      onClearQueue: async () => {
        await clearContributionQueue();
        await refresh();
      },
      onImport: async (file) => {
        await refresh(importResultLine(await importHistory(await file.text())));
      },
      onAcknowledgePolicy: async () => {
        await setAcknowledgedPolicyVersion(PRIVACY_POLICY_VERSION);
        await refresh();
      },
    },
  );
}

void refresh();
