import { safeThumbnailUrl } from "../extract/sites";
import { ENGLISH_TRANSLATOR, type Translator } from "../i18n/translator";
import type { PolicyChange } from "../privacy/commitments";
import type { Rescored } from "../score/rescore";
import { BAND_COLORS, summarizeReport } from "../score/report";
import { bandLabel } from "../score/reportText";
import type { HistoryEntry } from "../storage/history";
import { escapeHtml } from "./escape";
import { bindPolicyNotice, policyNoticeMarkup } from "./policyNotice";
import { bindWatchlist, watchlistMarkup } from "./watchlistView";
import type { WatchEntry } from "../storage/watchlist";

export interface PopupCallbacks {
  onExportJson: () => void;
  onExportCsv: () => void;
  onDeleteAll: () => void;
  onOpenSettings: () => void;
  onOpenEntry?: (id: number) => void;
  onAcknowledgePolicy?: () => void;
  onUnwatch?: (productKey: string) => void;
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

export function matchesQuery(entry: HistoryEntry, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  return trimmed === "" || entry.title.toLowerCase().includes(trimmed);
}

export interface PopupOptions {
  pendingPolicyChanges?: readonly PolicyChange[];
  now?: number;
  translator?: Translator;
  watchlist?: readonly WatchEntry[];
}

export function renderPopup(
  container: HTMLElement,
  entries: readonly HistoryRow[],
  callbacks: PopupCallbacks,
  query = "",
  options: PopupOptions = {},
): void {
  const t = options.translator ?? ENGLISH_TRANSLATOR;
  const shown = groupByProduct(entries).filter((entry) => matchesQuery(entry, query));
  container.innerHTML = `
    <header>
      <span class="wordmark">verdict</span>
      <button type="button" class="open-settings" aria-label="${
        t.text("popup.settings")
      }">&#9881;</button>
    </header>
    ${policyNoticeMarkup(options.pendingPolicyChanges ?? [], options.now ?? Date.now())}
    ${watchlistMarkup(options.watchlist ?? [], t)}
    ${
      entries.length === 0
        ? ""
        : `<div class="search">
      <input type="search" class="search-input" aria-label="${t.text("popup.search")}"
        placeholder="${t.text("popup.searchPlaceholder")}" value="${escapeHtml(query)}" />
    </div>`
    }
    <div class="register" role="list">
      ${
        entries.length === 0
          ? `<p class="empty">${t.text("popup.empty")}</p>`
          : shown.length === 0
            ? `<p class="empty">${t.text("popup.noMatches")}</p>`
            : shown.map((entry) => renderRow(entry, t)).join("")
      }
    </div>
    <footer>
      <button type="button" class="export-json">${t.text("popup.exportJson")}</button>
      <button type="button" class="export-csv">${t.text("popup.exportCsv")}</button>
      <button type="button" class="delete-all">${t.text("popup.deleteAll")}</button>
    </footer>
  `;

  bindPolicyNotice(container, {
    onAcknowledge: () => callbacks.onAcknowledgePolicy?.(),
  });
  bindWatchlist(container, { onUnwatch: callbacks.onUnwatch });

  container.querySelector(".open-settings")?.addEventListener("click", callbacks.onOpenSettings);
  container.querySelector(".export-json")?.addEventListener("click", callbacks.onExportJson);
  container.querySelector(".export-csv")?.addEventListener("click", callbacks.onExportCsv);

  const search = container.querySelector<HTMLInputElement>(".search-input");
  search?.addEventListener("input", () => {
    renderPopup(container, entries, callbacks, search.value, options);
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
    deleteButton.textContent = t.text("popup.confirmDelete");
  });
}

function renderRow(entry: HistoryRow, t: Translator): string {
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
      ${
        (entry.checkCount ?? 1) > 1
          ? `<span class="repeat">${t.number(entry.checkCount ?? 1)}&times;</span>`
          : ""
      }
      ${
        shownBand !== null
          ? `<span class="band" style="color: ${BAND_COLORS[shownBand]}">${
            bandLabel(shownBand, t)
          }</span>`
          : ""
      }
      ${
        adjustedRating !== null
          ? `<span class="rating">${t.decimal(adjustedRating, 1)}</span>`
          : ""
      }
      <span class="date">${t.date(entry.timestamp)}</span>
    </button>
    </div>
  `;
}
