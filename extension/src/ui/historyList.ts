import { safeThumbnailUrl } from "../extract/sites";
import type { Rescored } from "../score/rescore";
import { BAND_COLORS, BAND_LABELS, summarizeReport } from "../score/report";
import type { HistoryEntry } from "../storage/history";
import { escapeHtml } from "./escape";

export interface PopupCallbacks {
  onExportJson: () => void;
  onExportCsv: () => void;
  onDeleteAll: () => void;
  onOpenSettings: () => void;
  onOpenEntry?: (id: number) => void;
}

export interface HistoryRow extends HistoryEntry {
  rescored?: Rescored | null;
  // how many checks of this listing this row stands for, itself included
  checkCount?: number;
}

// repeat visits to one listing collapse to its newest check, with the rest behind it
export function groupByProduct(entries: readonly HistoryRow[]): HistoryRow[] {
  const newestFor = new Map<string, HistoryRow>();
  const rows: HistoryRow[] = [];
  for (const entry of entries) {
    const key = entry.productKey ?? null;
    if (key === null) {
      rows.push({ ...entry, checkCount: 1 });
      continue;
    }
    const seen = newestFor.get(key);
    if (seen === undefined) {
      const row = { ...entry, checkCount: 1 };
      newestFor.set(key, row);
      rows.push(row);
      continue;
    }
    seen.checkCount = (seen.checkCount ?? 1) + 1;
  }
  return rows;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function matchesQuery(entry: HistoryEntry, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  return trimmed === "" || entry.title.toLowerCase().includes(trimmed);
}

export function renderPopup(
  container: HTMLElement,
  entries: readonly HistoryRow[],
  callbacks: PopupCallbacks,
  query = "",
): void {
  const shown = groupByProduct(entries).filter((entry) => matchesQuery(entry, query));
  container.innerHTML = `
    <header>
      <span class="wordmark">verdict</span>
      <button type="button" class="open-settings" aria-label="Settings">&#9881;</button>
    </header>
    ${
      entries.length === 0
        ? ""
        : `<div class="search">
      <input type="search" class="search-input" aria-label="Search checks" placeholder="search"
        value="${escapeHtml(query)}" />
    </div>`
    }
    <div class="register" role="list">
      ${
        entries.length === 0
          ? `<p class="empty">No checks yet.</p>`
          : shown.length === 0
            ? `<p class="empty">No checks match that.</p>`
            : shown.map((entry) => renderRow(entry)).join("")
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

  const search = container.querySelector<HTMLInputElement>(".search-input");
  search?.addEventListener("input", () => {
    renderPopup(container, entries, callbacks, search.value);
    // rerendering replaces the box, so the caret goes back where it was
    const refreshed = container.querySelector<HTMLInputElement>(".search-input");
    refreshed?.focus();
    refreshed?.setSelectionRange(refreshed.value.length, refreshed.value.length);
  });

  for (const row of container.querySelectorAll<HTMLButtonElement>(".row")) {
    row.addEventListener("click", () => {
      const id = Number(row.dataset.id);
      if (Number.isFinite(id)) {
        callbacks.onOpenEntry?.(id);
      }
    });
  }

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

function renderRow(entry: HistoryRow): string {
  const { band, adjustedRating } = summarizeReport(entry.report);
  // the current model's reading, where there is one, so an old band does not go stale
  const shownBand = entry.rescored?.band ?? band;
  // revalidated here too, since an older build stored whatever the page said
  const thumbnail = safeThumbnailUrl(entry.thumbnailUrl);
  return `
    <div role="listitem">
    <button type="button" class="row" data-id="${entry.id}">
      ${
        thumbnail !== null
          ? `<img src="${escapeHtml(thumbnail)}" alt="" width="32" height="32" />`
          : ""
      }
      <span class="title">${escapeHtml(entry.title)}</span>
      ${(entry.checkCount ?? 1) > 1 ? `<span class="repeat">${entry.checkCount}&times;</span>` : ""}
      ${
        shownBand !== null
          ? `<span class="band" style="color: ${BAND_COLORS[shownBand]}">${BAND_LABELS[shownBand]}</span>`
          : ""
      }
      ${adjustedRating !== null ? `<span class="rating">${adjustedRating.toFixed(1)}</span>` : ""}
      <span class="date">${formatDate(entry.timestamp)}</span>
    </button>
    </div>
  `;
}
