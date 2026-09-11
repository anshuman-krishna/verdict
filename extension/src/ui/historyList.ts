import { safeThumbnailUrl } from "../extract/sites";
import { BAND_COLORS, BAND_LABELS, summarizeReport } from "../score/report";
import type { HistoryEntry } from "../storage/history";
import { escapeHtml } from "./escape";

export interface PopupCallbacks {
  onExportJson: () => void;
  onExportCsv: () => void;
  onDeleteAll: () => void;
  onOpenSettings: () => void;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function renderPopup(
  container: HTMLElement,
  entries: readonly HistoryEntry[],
  callbacks: PopupCallbacks,
): void {
  container.innerHTML = `
    <header>
      <span class="wordmark">verdict</span>
      <button type="button" class="open-settings" aria-label="Settings">&#9881;</button>
    </header>
    <div class="register" role="list">
      ${
        entries.length === 0
          ? `<p class="empty">No checks yet.</p>`
          : entries.map((entry) => renderRow(entry)).join("")
      }
    </div>
    <footer>
      <button type="button" class="export-json">export json</button>
      <button type="button" class="export-csv">export csv</button>
      <button type="button" class="delete-all">delete everything</button>
    </footer>
  `;

  container.querySelector(".open-settings")?.addEventListener("click", callbacks.onOpenSettings);
  container.querySelector(".export-json")?.addEventListener("click", callbacks.onExportJson);
  container.querySelector(".export-csv")?.addEventListener("click", callbacks.onExportCsv);

  const deleteButton = container.querySelector<HTMLButtonElement>(".delete-all");
  deleteButton?.addEventListener("click", () => {
    if (deleteButton.dataset.confirming === "true") {
      callbacks.onDeleteAll();
      return;
    }
    deleteButton.dataset.confirming = "true";
    deleteButton.textContent = "confirm delete";
  });
}

function renderRow(entry: HistoryEntry): string {
  const { band, adjustedRating } = summarizeReport(entry.report);
  // revalidated here too, since an older build stored whatever the page said
  const thumbnail = safeThumbnailUrl(entry.thumbnailUrl);
  return `
    <div class="row" role="listitem">
      ${
        thumbnail !== null
          ? `<img src="${escapeHtml(thumbnail)}" alt="" width="32" height="32" />`
          : ""
      }
      <span class="title">${escapeHtml(entry.title)}</span>
      ${
        band !== null
          ? `<span class="band" style="color: ${BAND_COLORS[band]}">${BAND_LABELS[band]}</span>`
          : ""
      }
      ${adjustedRating !== null ? `<span class="rating">${adjustedRating.toFixed(1)}</span>` : ""}
      <span class="date">${formatDate(entry.timestamp)}</span>
    </div>
  `;
}
