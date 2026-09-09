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
    },
  );
}

void refresh();
