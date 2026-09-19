import { ENGLISH_TRANSLATOR, type Translator } from "../i18n/translator";
import { safeThumbnailUrl } from "../extract/sites";
import { BAND_COLORS } from "../score/report";
import { bandLabel } from "../score/reportText";
import type { WatchEntry } from "../storage/watchlist";
import { compareReadings } from "../watchlist/drift";
import { changeLines } from "../watchlist/text";
import { escapeHtml } from "./escape";

export interface WatchlistCallbacks {
  onUnwatch?: (productKey: string) => void;
}

export function watchlistMarkup(
  entries: readonly WatchEntry[],
  t: Translator = ENGLISH_TRANSLATOR,
): string {
  if (entries.length === 0) {
    return "";
  }
  return `
    <section class="watchlist">
      <h2>${t.text("watchlist.heading")}</h2>
      <div class="watch-register" role="list">
        ${entries.map((entry) => renderWatched(entry, t)).join("")}
      </div>
    </section>
  `;
}

function renderWatched(entry: WatchEntry, t: Translator): string {
  const changes = compareReadings(entry.baseline, entry.latest);
  const lines = changeLines(changes, t);
  const band = entry.latest.band;
  const thumbnail = safeThumbnailUrl(entry.thumbnailUrl);
  return `
    <div class="watched" role="listitem">
      <div class="watched-head">
        ${
    thumbnail !== null
      ? `<img src="${escapeHtml(thumbnail)}" alt="" width="32" height="32" />`
      : ""
  }
        <span class="title">${escapeHtml(entry.title)}</span>
        ${
    band === null
      ? ""
      : `<span class="band" style="color: ${BAND_COLORS[band]}">${bandLabel(band, t)}</span>`
  }
        <button
          type="button"
          class="unwatch"
          data-key="${escapeHtml(entry.productKey)}"
          aria-label="${t.text("watchlist.remove")}"
        >&times;</button>
      </div>
      <p class="moved">${
    lines.length === 0
      ? t.text("watchlist.steady")
      : t.count("watchlist.moved", lines.length)
  }, ${t.text("watchlist.lastSeen", { when: t.date(entry.lastSeenAt) })}</p>
      ${lines.length === 0 ? "" : `<ul>${lines.map((line) => `<li>${line}</li>`).join("")}</ul>`}
    </div>
  `;
}

export function bindWatchlist(container: HTMLElement, callbacks: WatchlistCallbacks): void {
  for (const button of container.querySelectorAll<HTMLButtonElement>(".unwatch")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const key = button.dataset.key;
      if (key !== undefined && key !== "") {
        callbacks.onUnwatch?.(key);
      }
    });
  }
}
