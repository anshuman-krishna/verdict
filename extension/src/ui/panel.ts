import { ENGLISH_TRANSLATOR, type Translator } from "../i18n/translator";
import type { Report } from "../score/report";
import {
  bandLabel,
  evidenceDetail,
  signalLabel,
  signalLabels,
  strengthLabel,
} from "../score/reportText";
import type { PreviousCheck } from "../storage/history";
import { rosetteParams, rosettePath, type RosetteInput } from "./rosette";
import { DESIGN_TOKENS_CSS } from "./tokens";

const shadowRoots = new WeakMap<VerdictPanelElement, ShadowRoot>();

export function getPanelShadowRootForTesting(panel: VerdictPanelElement): ShadowRoot {
  const root = shadowRoots.get(panel);
  if (root === undefined) {
    throw new Error("panel has not been constructed");
  }
  return root;
}

const ROSETTE_DRAW_MS = 700;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia !== undefined
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

function relativeCheckedTime(generatedAt: number, now: number, t: Translator): string {
  const elapsedMs = now - generatedAt;
  if (elapsedMs < 60_000) {
    return t.text("panel.checkedJustNow");
  }
  const minutes = Math.round(elapsedMs / 60_000);
  if (minutes < 60) {
    return t.count("panel.checkedMinutes", minutes);
  }
  return t.count("panel.checkedHours", Math.round(minutes / 60));
}

function joinSignals(signals: readonly string[], t: Translator): string {
  return t.join(signalLabels(signals, t));
}

export function confidenceLine(report: Report, t: Translator = ENGLISH_TRANSLATOR): string {
  const low = Math.round(report.confidence.low * 100);
  const high = Math.round(report.confidence.high * 100);
  const estimate = low === high
    ? t.text("confidence.point", { percent: low })
    : t.text("confidence.range", { low, high });
  if (report.unavailableSignals.length === 0) {
    return estimate;
  }
  const widened = t.text("confidence.unavailable", {
    signals: joinSignals(report.unavailableSignals, t),
  });
  return `${estimate} ${widened}`;
}

export interface FullReportDetail {
  serial: string;
}

const MS_PER_DAY = 86_400_000;

function daysAgo(then: number, now: number, t: Translator): string {
  const days = Math.floor((now - then) / MS_PER_DAY);
  if (days < 1) {
    return t.text("when.earlierToday");
  }
  if (days === 1) {
    return t.text("when.yesterday");
  }
  if (days < 30) {
    return t.count("when.days", days);
  }
  return t.count("when.months", Math.round(days / 30));
}

// what changed since last time is the thing worth a sentence, not the count of visits
export function previouslyLine(
  report: Report,
  previous: PreviousCheck | undefined,
  now: number,
  t: Translator = ENGLISH_TRANSLATOR,
): string | null {
  if (previous === undefined) {
    return null;
  }
  const when = daysAgo(previous.timestamp, now, t);
  if (previous.band === null) {
    return t.text("previously.unknown", { when });
  }
  const band = bandLabel(previous.band, t);
  return previous.band === report.band
    ? t.text("previously.same", { when, band })
    : t.text("previously.changed", { when, band });
}

export interface PanelRenderOptions {
  pending?: readonly string[];
  now?: number;
  previousChecks?: readonly PreviousCheck[];
  translator?: Translator;
}

export function pendingLine(
  pending: readonly string[],
  t: Translator = ENGLISH_TRANSLATOR,
): string {
  return t.text("pending.line", { signals: joinSignals(pending, t) });
}

export class VerdictPanelElement extends HTMLElement {
  private report: Report | null = null;
  private focusableSelector =
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  constructor() {
    super();
    const root = this.attachShadow({ mode: "closed" });
    shadowRoots.set(this, root);
  }

  connectedCallback(): void {
    this.addEventListener("keydown", this.handleKeydown);
  }

  disconnectedCallback(): void {
    this.removeEventListener("keydown", this.handleKeydown);
  }

  render(
    report: Report,
    rosetteInput: RosetteInput,
    now: number = Date.now(),
    options: PanelRenderOptions = {},
  ): void {
    this.report = report;
    const root = shadowRoots.get(this);
    if (root === undefined) {
      return;
    }

    const t = options.translator ?? ENGLISH_TRANSLATOR;
    const pending = options.pending ?? [];
    const previously = previouslyLine(report, options.previousChecks?.[0], now, t);

    const params = rosetteParams(rosetteInput);
    const path = rosettePath(params, 44);
    const band = bandLabel(report.band, t);
    const kept = report.totalReviewCount - report.excludedReviewCount;
    const reducedMotion = prefersReducedMotion();

    root.innerHTML = `
      <style>${DESIGN_TOKENS_CSS}${PANEL_CSS}</style>
      <div class="panel" role="region" aria-label="${t.text("panel.regionLabel")}">
        <header>
          <span class="wordmark">verdict</span>
          <button type="button" class="close" aria-label="${t.text("panel.close")}">&times;</button>
        </header>

        <div class="headline">
          <svg
            class="rosette"
            viewBox="-50 -50 100 100"
            role="img"
            aria-labelledby="rosette-alt"
          >
            <title id="rosette-alt">${t.text("panel.rosetteAlt", {
              band,
              percent: Math.round(report.estimatedInorganicShare * 100),
            })}</title>
            <path
              d="${path}"
              fill="none"
              stroke="${params.strokeColor}"
              stroke-width="1.5"
              class="rosette-path${reducedMotion ? " no-motion" : ""}"
            />
          </svg>
          <dl class="figures">
            <div>
              <dd class="adjusted">${t.decimal(report.adjustedRating, 1)}</dd>
              <dt>${t.text("panel.adjusted")}</dt>
            </div>
            <div>
              <dd class="claimed">${t.decimal(report.claimedRating, 1)}</dd>
              <dt>${t.text("panel.claimed")}</dt>
            </div>
          </dl>
        </div>

        <p class="summary">
          ${t.text("panel.summary", {
            band,
            excluded: report.excludedReviewCount,
            total: report.totalReviewCount,
          })}
        </p>

        <div
          class="specimen-strip"
          role="img"
          aria-label="${t.text("panel.stripAlt", {
            kept,
            excluded: report.excludedReviewCount,
          })}"
        >
          <div class="kept" style="flex-grow: ${kept}"></div>
          <div class="excluded" style="flex-grow: ${report.excludedReviewCount}"></div>
        </div>
        <div class="specimen-labels">
          <span>${t.count("panel.kept", kept)}</span>
          <span>${t.count("panel.excluded", report.excludedReviewCount)}</span>
        </div>

        <div
          class="interval"
          role="img"
          aria-label="${confidenceLine(report, t)}"
        >
          <div
            class="interval-span"
            style="margin-left: ${(report.confidence.low * 100).toFixed(2)}%; width: ${
              Math.max(report.confidence.high - report.confidence.low, 0.005) * 100
            }%"
          ></div>
        </div>
        <p class="interval-note">${confidenceLine(report, t)}</p>
        ${previously === null ? "" : `<p class="previously">${previously}</p>`}
        ${
      pending.length === 0
        ? ""
        : `<p class="pending" role="status">${pendingLine(pending, t)}</p>`
    }

        <div class="evidence">
          <h2>${t.text("panel.evidence")}</h2>
          <div class="register" role="list">
            ${report.evidence
              .map(
                (row, index) => `
              <div class="row" role="listitem">
                <button
                  type="button"
                  class="row-toggle"
                  aria-expanded="false"
                  aria-controls="evidence-detail-${index}"
                >
                  <span class="signal">${signalLabel(row.signal, t)}</span>
                  <span class="strength">${strengthLabel(row.strength, t)}</span>
                  <span class="disclosure" aria-hidden="true">&gt;</span>
                </button>
                <div class="detail" id="evidence-detail-${index}" hidden>${
                  evidenceDetail(row, t)
                }</div>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>

        <footer>
          <span class="checked">${relativeCheckedTime(report.generatedAt, now, t)}</span>
          <button type="button" class="full-report">${t.text("panel.fullReport")}</button>
        </footer>
      </div>
    `;

    this.wireEvidenceToggles(root);
    this.wireClose(root);
    this.wireFullReport(root);

    if (!reducedMotion) {
      this.animateDraw(root);
    }
  }

  private wireEvidenceToggles(root: ShadowRoot): void {
    for (const toggle of root.querySelectorAll<HTMLButtonElement>(".row-toggle")) {
      toggle.addEventListener("click", () => {
        const expanded = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!expanded));
        const detailId = toggle.getAttribute("aria-controls");
        const detail = detailId !== null ? root.getElementById(detailId) : null;
        if (detail !== null) {
          detail.hidden = expanded;
        }
      });
    }
  }

  private wireClose(root: ShadowRoot): void {
    const closeButton = root.querySelector(".close");
    closeButton?.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("verdict:close", { bubbles: true, composed: true }));
    });
  }

  private wireFullReport(root: ShadowRoot): void {
    const fullReportButton = root.querySelector(".full-report");
    fullReportButton?.addEventListener("click", () => {
      // the serial names which stored report to open, so the button lands on this one
      this.dispatchEvent(
        new CustomEvent<FullReportDetail>("verdict:full-report", {
          bubbles: true,
          composed: true,
          detail: { serial: this.report?.serial ?? "" },
        }),
      );
    });
  }

  private animateDraw(root: ShadowRoot): void {
    const path = root.querySelector<SVGPathElement>(".rosette-path");
    if (path === null || typeof path.getTotalLength !== "function") {
      return;
    }
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;
    path.style.transition = `stroke-dashoffset ${ROSETTE_DRAW_MS}ms ease-out`;
    requestAnimationFrame(() => {
      path.style.strokeDashoffset = "0";
    });
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      this.dispatchEvent(new CustomEvent("verdict:close", { bubbles: true, composed: true }));
      return;
    }
    if (event.key === "Tab") {
      this.trapFocus(event);
    }
  };

  private trapFocus(event: KeyboardEvent): void {
    const root = shadowRoots.get(this);
    if (root === undefined) {
      return;
    }
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(this.focusableSelector),
    ).filter((el) => !el.hasAttribute("hidden"));
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    const active = root.activeElement as HTMLElement | null;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

if (typeof customElements !== "undefined" && customElements.get("verdict-panel") === undefined) {
  customElements.define("verdict-panel", VerdictPanelElement);
}

const PANEL_CSS = `
* { box-sizing: border-box; }

.panel {
  width: 360px;
  background: var(--paper-raised);
  color: var(--ink);
  border: 1px solid var(--rule);
  border-radius: 2px 2px 0 0;
  font-family: "Public Sans", system-ui, sans-serif;
  font-size: 1.0625rem;
  line-height: 1.5;
  padding: 16px;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.wordmark {
  font-family: "Bricolage Grotesque", system-ui, sans-serif;
  font-weight: 600;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

button.close {
  font-size: 1.25rem;
  line-height: 1;
}

button.close:focus-visible,
button.row-toggle:focus-visible,
button.full-report:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.headline {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 12px;
}

.rosette {
  width: 72px;
  height: 72px;
  flex-shrink: 0;
}

.rosette-path.no-motion {
  stroke-dasharray: none;
  stroke-dashoffset: 0;
}

.figures {
  margin: 0;
  font-family: "Fragment Mono", ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}

.figures div {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.figures dd {
  margin: 0;
  font-size: 1.5rem;
}

.figures dt {
  color: var(--ink-soft);
  font-family: "Public Sans", system-ui, sans-serif;
}

.summary {
  margin: 12px 0 0;
}

.specimen-strip {
  display: flex;
  height: 10px;
  margin-top: 12px;
  border-radius: 1px;
  overflow: hidden;
}

.specimen-strip .kept {
  background: var(--accent);
}

.specimen-strip .excluded {
  background-image: repeating-linear-gradient(
    45deg,
    var(--cancel),
    var(--cancel) 2px,
    transparent 2px,
    transparent 4px
  );
  background-color: var(--paper-sunk);
}

.specimen-labels {
  display: flex;
  justify-content: space-between;
  font-family: "Fragment Mono", ui-monospace, monospace;
  font-size: 0.875rem;
  color: var(--ink-soft);
  margin-top: 4px;
}

.interval {
  position: relative;
  height: 6px;
  margin-top: 12px;
  border-radius: 1px;
  background: var(--paper-sunk);
}

.interval-span {
  height: 100%;
  border-radius: 1px;
  background: var(--ink-soft);
}

.interval-note {
  font-size: 0.875rem;
  color: var(--ink-soft);
  margin: 4px 0 0;
}

.pending {
  font-size: 0.875rem;
  font-style: italic;
  color: var(--ink-soft);
  margin: 4px 0 0;
}

.evidence h2 {
  font-size: 0.875rem;
  font-weight: 400;
  color: var(--ink-soft);
  margin: 16px 0 4px;
}

.register .row {
  border-top: 1px solid var(--rule);
}

.register .row:nth-child(even) {
  background: var(--paper-sunk);
}

.row-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  text-align: left;
}

.row-toggle .signal {
  flex: 1;
}

.row-toggle .strength {
  color: var(--ink-soft);
}

.detail {
  padding: 0 4px 8px;
  color: var(--ink-soft);
}

footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  font-size: 0.875rem;
  color: var(--ink-soft);
}

.previously {
  font-size: 0.875rem;
  color: var(--ink-soft);
  margin: 8px 0 0;
}

footer .full-report {
  color: var(--ink);
  text-decoration: underline;
  text-underline-offset: 2px;
}
`;
