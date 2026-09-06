import { setGraphContributionWithPermission } from "../../graph/permission";
import { setReputationLookupWithPermission } from "../../reputation/permission";
import { deleteAllHistory, exportHistoryAsCsv, exportHistoryAsJson } from "../../storage/history";
import {
  getGraphContributionEnabled,
  getHistoryEnabled,
  getReputationLookupEnabled,
  setHistoryEnabled,
} from "../../storage/settings";
import { renderOptions } from "../../ui/optionsPage";

function download(filename: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function refresh(): Promise<void> {
  const app = document.getElementById("app");
  if (app === null) {
    return;
  }
  const historyEnabled = await getHistoryEnabled();
  const reputationLookupEnabled = await getReputationLookupEnabled();
  const graphContributionEnabled = await getGraphContributionEnabled();
  renderOptions(
    app,
    { historyEnabled, reputationLookupEnabled, graphContributionEnabled },
    {
      onToggleHistory: async (enabled) => {
        await setHistoryEnabled(enabled);
      },
      onToggleReputationLookup: async (enabled) => {
        // turning it on can be denied by the browser's permission prompt,
        // turning it off releases the permission; either way the actually
        // persisted state may differ from what the checkbox now shows, so
        // this re-renders from the real stored value rather than trusting
        // the click.
        await setReputationLookupWithPermission(enabled);
        await refresh();
      },
      onToggleGraphContribution: async (enabled) => {
        // optionsPage.ts already gated this behind PRIVACY.md section 5's
        // disclosure and an explicit Confirm click before this ever
        // fires with enabled === true; requesting the host permission
        // and persisting the setting are what is left, same shape as
        // reputation lookup above, since they share one origin.
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
    },
  );
}

void refresh();
