import { deleteAllHistory, exportHistoryAsCsv, exportHistoryAsJson } from "../../storage/history";
import { getHistoryEnabled, setHistoryEnabled } from "../../storage/settings";
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
  renderOptions(
    app,
    { historyEnabled },
    {
      onToggleHistory: async (enabled) => {
        await setHistoryEnabled(enabled);
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
