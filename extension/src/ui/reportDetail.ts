import { safeThumbnailUrl } from "../extract/sites";
import type { Rescored } from "../score/rescore";
import { BAND_COLORS, BAND_LABELS, parseStoredReport, type Report } from "../score/report";
import { provenanceLines } from "../score/reportDocument";
import type { HistoryEntry, PreviousCheck } from "../storage/history";
import { escapeHtml } from "./escape";

export interface ReportDetailCallbacks {
  onBack: () => void;
  onExportText?: (report: Report) => void;
  onExportJson?: (report: Report) => void;
}

function percent(share: number): number {
  return Math.round(share * 100);
}

export function intervalLine(report: Report): string {
  const low = percent(report.confidence.low);
  const high = percent(report.confidence.high);
  return low === high
    ? `Estimated ${low} percent of reviews.`
    : `Estimated between ${low} and ${high} percent of reviews.`;
}

export function unavailableLine(report: Report): string | null {
  if (report.unavailableSignals.length === 0) {
    return null;
  }
  const signals = report.unavailableSignals;
  const joined =
    signals.length < 2
      ? (signals[0] as string)
      : `${signals.slice(0, -1).join(", ")} and ${signals[signals.length - 1]}`;
  return `${joined} could not be read on this page, which widens the estimate.`;
}

// the stored band came from the model that was current when the check ran
export function rescoredLine(report: Report, rescored: Rescored | null): string | null {
  if (rescored === null || rescored.band === report.band) {
    return null;
  }
  return `Scored again with the current model, this reads as ${BAND_LABELS[rescored.band]}.`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function earlierChecksMarkup(checks: readonly PreviousCheck[]): string {
  if (checks.length === 0) {
    return "";
  }
  const rows = checks
    .map((check) => {
      const band = check.band === null ? "" : BAND_LABELS[check.band];
      const rating = check.adjustedRating === null ? "" : check.adjustedRating.toFixed(1);
      return `<div class="earlier-row"><span>${formatDate(check.timestamp)}</span>` +
        `<span>${band}</span><span>${rating}</span></div>`;
    })
    .join("");
  return `<h2>earlier checks</h2><div class="earlier">${rows}</div>`;
}

export function renderReportDetail(
  container: HTMLElement,
  entry: HistoryEntry,
  rescored: Rescored | null,
  callbacks: ReportDetailCallbacks,
  earlierChecks: readonly PreviousCheck[] = [],
): void {
  const report = parseStoredReport(entry.report);
  const thumbnail = safeThumbnailUrl(entry.thumbnailUrl);

  container.innerHTML = `
    <header>
      <button type="button" class="back" aria-label="Back to history">&#8592;</button>
      <span class="wordmark">verdict</span>
    </header>
    <div class="detail">
      <div class="detail-head">
        ${thumbnail !== null ? `<img src="${escapeHtml(thumbnail)}" alt="" width="40" height="40" />` : ""}
        <span class="detail-title">${escapeHtml(entry.title)}</span>
      </div>
      ${report === null ? unreadable() : body(report, rescored)}
      <p class="checked">Checked ${formatDate(entry.timestamp)}.</p>
      ${earlierChecksMarkup(earlierChecks)}
    </div>
  `;

  container.querySelector(".back")?.addEventListener("click", callbacks.onBack);
  if (report !== null) {
    container
      .querySelector(".export-report")
      ?.addEventListener("click", () => callbacks.onExportText?.(report));
    container
      .querySelector(".export-report-json")
      ?.addEventListener("click", () => callbacks.onExportJson?.(report));
  }
  wireEvidence(container);
}

function unreadable(): string {
  return `<p class="empty">This check was saved by an older version, so only its heading is readable.</p>`;
}

function body(report: Report, rescored: Rescored | null): string {
  const kept = report.totalReviewCount - report.excludedReviewCount;
  const restated = rescoredLine(report, rescored);
  const unavailable = unavailableLine(report);
  return `
    <p class="detail-band" style="color: ${BAND_COLORS[report.band]}">${BAND_LABELS[report.band]}</p>
    <dl class="figures">
      <div><dd>${report.adjustedRating.toFixed(1)}</dd><dt>adjusted</dt></div>
      <div><dd>${report.claimedRating.toFixed(1)}</dd><dt>claimed</dt></div>
    </dl>
    <div class="strip" role="img" aria-label="${kept.toLocaleString()} reviews kept, ${report.excludedReviewCount.toLocaleString()} excluded">
      <div class="kept" style="flex-grow: ${kept}"></div>
      <div class="excluded" style="flex-grow: ${report.excludedReviewCount}"></div>
    </div>
    <p class="strip-labels">
      <span>kept ${kept.toLocaleString()}</span>
      <span>excluded ${report.excludedReviewCount.toLocaleString()}</span>
    </p>
    <p class="interval">${intervalLine(report)}</p>
    ${unavailable === null ? "" : `<p class="unavailable">${unavailable}</p>`}
    ${restated === null ? "" : `<p class="rescored">${restated}</p>`}
    <h2>evidence</h2>
    <div class="register" role="list">
      ${report.evidence.map(evidenceRow).join("")}
    </div>
    <h2>how this was produced</h2>
    <ul class="provenance">
      ${provenanceLines(report.provenance).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
    </ul>
    <div class="actions">
      <button type="button" class="export-report">Export this report</button>
      <button type="button" class="export-report-json">Export as JSON</button>
    </div>
    ${report.serial === "" ? "" : `<p class="serial">${escapeHtml(report.serial)}</p>`}
  `;
}

function evidenceRow(row: Report["evidence"][number], index: number): string {
  return `
    <div class="row" role="listitem">
      <button
        type="button"
        class="row-toggle"
        aria-expanded="false"
        aria-controls="detail-evidence-${index}"
      >
        <span class="signal">${escapeHtml(row.signal)}</span>
        <span class="strength">${escapeHtml(row.strength)}</span>
      </button>
      <div class="detail-text" id="detail-evidence-${index}" hidden>${escapeHtml(row.detail)}</div>
    </div>
  `;
}

function wireEvidence(container: HTMLElement): void {
  for (const toggle of container.querySelectorAll<HTMLButtonElement>(".row-toggle")) {
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      const id = toggle.getAttribute("aria-controls");
      const detail = id === null ? null : container.querySelector<HTMLElement>(`#${id}`);
      if (detail !== null) {
        detail.hidden = expanded;
      }
    });
  }
}
