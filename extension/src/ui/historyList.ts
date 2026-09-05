import { BAND_COLORS, BAND_LABELS, type Band } from "../score/report";
import type { HistoryEntry } from "../storage/history";

export interface PopupCallbacks {
  onExportJson: () => void;
  onExportCsv: () => void;
  onDeleteAll: () => void;
}

// the history store predates the Report type and keeps its field as
// unknown, so this is a system boundary: a legacy or malformed entry is
// rendered without a band rather than thrown away or crashing the popup.
function summarizeReport(report: unknown): { band: Band | null; adjustedRating: number | null } {
  if (typeof report !== "object" || report === null) {
    return { band: null, adjustedRating: null };
  }
  const value = report as Record<string, unknown>;
  const band = typeof value.band === "string" && value.band in BAND_LABELS
    ? (value.band as Band)
    : null;
  const adjustedRating = typeof value.adjustedRating === "number" ? value.adjustedRating : null;
  return { band, adjustedRating };
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
  return `
    <div class="row" role="listitem">
      ${
        entry.thumbnailUrl !== null
          ? `<img src="${entry.thumbnailUrl}" alt="" width="32" height="32" />`
          : ""
      }
      <span class="title">${entry.title}</span>
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
