import { safeThumbnailUrl } from "../extract/sites";
import { ENGLISH_TRANSLATOR, type Translator } from "../i18n/translator";
import type { Rescored } from "../score/rescore";
import { BAND_COLORS, parseStoredReport, type Report } from "../score/report";
import { bandLabel, evidenceDetail, signalLabel, strengthLabel } from "../score/reportText";
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

export function intervalLine(report: Report, t: Translator = ENGLISH_TRANSLATOR): string {
  const low = percent(report.confidence.low);
  const high = percent(report.confidence.high);
  return low === high
    ? t.text("detail.intervalPoint", { percent: low })
    : t.text("detail.intervalRange", { low, high });
}

export function unavailableLine(
  report: Report,
  t: Translator = ENGLISH_TRANSLATOR,
): string | null {
  if (report.unavailableSignals.length === 0) {
    return null;
  }
  const named = report.unavailableSignals.map((signal) => signalLabel(signal, t));
  return t.text("detail.unavailable", { signals: t.join(named) });
}

// the stored band came from the model that was current when the check ran
export function rescoredLine(
  report: Report,
  rescored: Rescored | null,
  t: Translator = ENGLISH_TRANSLATOR,
): string | null {
  if (rescored === null || rescored.band === report.band) {
    return null;
  }
  return t.text("detail.rescored", { band: bandLabel(rescored.band, t) });
}

export function earlierChecksMarkup(
  checks: readonly PreviousCheck[],
  t: Translator = ENGLISH_TRANSLATOR,
): string {
  if (checks.length === 0) {
    return "";
  }
  const rows = checks
    .map((check) => {
      const band = check.band === null ? "" : bandLabel(check.band, t);
      const rating = check.adjustedRating === null ? "" : t.decimal(check.adjustedRating, 1);
      return `<div class="earlier-row"><span>${t.date(check.timestamp)}</span>` +
        `<span>${band}</span><span>${rating}</span></div>`;
    })
    .join("");
  return `<h2>${t.text("detail.earlierChecks")}</h2><div class="earlier">${rows}</div>`;
}

export function renderReportDetail(
  container: HTMLElement,
  entry: HistoryEntry,
  rescored: Rescored | null,
  callbacks: ReportDetailCallbacks,
  earlierChecks: readonly PreviousCheck[] = [],
  t: Translator = ENGLISH_TRANSLATOR,
): void {
  const report = parseStoredReport(entry.report);
  const thumbnail = safeThumbnailUrl(entry.thumbnailUrl);

  container.innerHTML = `
    <header>
      <button type="button" class="back" aria-label="${t.text("detail.back")}">&#8592;</button>
      <span class="wordmark">verdict</span>
    </header>
    <div class="detail">
      <div class="detail-head">
        ${thumbnail !== null ? `<img src="${escapeHtml(thumbnail)}" alt="" width="40" height="40" />` : ""}
        <span class="detail-title">${escapeHtml(entry.title)}</span>
      </div>
      ${report === null ? unreadable(t) : body(report, rescored, t)}
      <p class="checked">${t.text("detail.checked", { date: t.date(entry.timestamp) })}</p>
      ${earlierChecksMarkup(earlierChecks, t)}
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

function unreadable(t: Translator): string {
  return `<p class="empty">${t.text("detail.unreadable")}</p>`;
}

function body(report: Report, rescored: Rescored | null, t: Translator): string {
  const kept = report.totalReviewCount - report.excludedReviewCount;
  const restated = rescoredLine(report, rescored, t);
  const unavailable = unavailableLine(report, t);
  return `
    <p class="detail-band" style="color: ${BAND_COLORS[report.band]}">${bandLabel(report.band, t)}</p>
    <dl class="figures">
      <div><dd>${t.decimal(report.adjustedRating, 1)}</dd><dt>${t.text("panel.adjusted")}</dt></div>
      <div><dd>${t.decimal(report.claimedRating, 1)}</dd><dt>${t.text("panel.claimed")}</dt></div>
    </dl>
    <div class="strip" role="img" aria-label="${
      t.text("detail.stripAlt", { kept, excluded: report.excludedReviewCount })
    }">
      <div class="kept" style="flex-grow: ${kept}"></div>
      <div class="excluded" style="flex-grow: ${report.excludedReviewCount}"></div>
    </div>
    <p class="strip-labels">
      <span>${t.count("panel.kept", kept)}</span>
      <span>${t.count("panel.excluded", report.excludedReviewCount)}</span>
    </p>
    <p class="interval">${intervalLine(report, t)}</p>
    ${unavailable === null ? "" : `<p class="unavailable">${unavailable}</p>`}
    ${restated === null ? "" : `<p class="rescored">${restated}</p>`}
    <h2>${t.text("detail.evidence")}</h2>
    <div class="register" role="list">
      ${report.evidence.map((row, index) => evidenceRow(row, index, t)).join("")}
    </div>
    <h2>${t.text("detail.howProduced")}</h2>
    <ul class="provenance">
      ${provenanceLines(report.provenance).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
    </ul>
    <div class="actions">
      <button type="button" class="export-report">${t.text("detail.exportText")}</button>
      <button type="button" class="export-report-json">${t.text("detail.exportJson")}</button>
    </div>
    ${report.serial === "" ? "" : `<p class="serial">${escapeHtml(report.serial)}</p>`}
  `;
}

function evidenceRow(row: Report["evidence"][number], index: number, t: Translator): string {
  return `
    <div class="row" role="listitem">
      <button
        type="button"
        class="row-toggle"
        aria-expanded="false"
        aria-controls="detail-evidence-${index}"
      >
        <span class="signal">${escapeHtml(signalLabel(row.signal, t))}</span>
        <span class="strength">${escapeHtml(strengthLabel(row.strength, t))}</span>
      </button>
      <div class="detail-text" id="detail-evidence-${index}" hidden>${
        escapeHtml(evidenceDetail(row, t))
      }</div>
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
