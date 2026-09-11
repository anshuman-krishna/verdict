import { browser } from "wxt/browser";
import { rescore } from "../../score/rescore";
import { BUNDLED_MODEL } from "../../score/model";
import { parseStoredReport } from "../../score/report";
import {
  deleteAllHistory,
  exportHistoryAsCsv,
  exportHistoryAsJson,
  listChecksOfProduct,
  listHistory,
  type HistoryEntry,
} from "../../storage/history";
import { renderPopup } from "../../ui/historyList";
import { renderReportDetail } from "../../ui/reportDetail";

function download(filename: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// the panel opens /popup.html#SERIAL, so the report it was showing comes up first
export function entryForSerial(
  entries: readonly HistoryEntry[],
  hash: string,
): HistoryEntry | null {
  let serial: string;
  try {
    serial = decodeURIComponent(hash.replace(/^#/, "")).toUpperCase();
  } catch {
    // a hash anyone can type must not leave the popup blank
    return null;
  }
  if (serial === "") {
    return null;
  }
  return entries.find((entry) => parseStoredReport(entry.report)?.serial === serial) ?? null;
}

async function refresh(openId: number | null = null): Promise<void> {
  const app = document.getElementById("app");
  if (app === null) {
    return;
  }
  const entries = await listHistory();
  const open = entries.find((entry) => entry.id === openId) ?? null;

  if (open !== null) {
    const earlier = await listChecksOfProduct(open.productKey ?? "", open.timestamp);
    renderReportDetail(
      app,
      open,
      rescore(open, BUNDLED_MODEL),
      { onBack: () => void refresh() },
      earlier,
    );
    return;
  }

  renderPopup(
    app,
    entries.map((entry) => ({ ...entry, rescored: rescore(entry, BUNDLED_MODEL) })),
    {
      onExportJson: async () =>
        download("verdict-history.json", await exportHistoryAsJson(), "application/json"),
      onExportCsv: async () =>
        download("verdict-history.csv", await exportHistoryAsCsv(), "text/csv"),
      onDeleteAll: async () => {
        await deleteAllHistory();
        await refresh();
      },
      onOpenSettings: () => browser.runtime.openOptionsPage(),
      onOpenEntry: (id) => void refresh(id),
    },
  );
}

async function start(): Promise<void> {
  const entries = await listHistory();
  await refresh(entryForSerial(entries, location.hash)?.id ?? null);
}

void start();
