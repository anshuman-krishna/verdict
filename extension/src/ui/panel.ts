import type { Report } from "../score/report";
import { BAND_LABELS } from "../score/report";
import { rosetteParams, rosettePath, type RosetteInput } from "./rosette";
import { DESIGN_TOKENS_CSS } from "./tokens";

// DESIGN.md renders the panel in a closed shadow root so a hostile host
// page stylesheet cannot make verdict say something it does not say. a
// closed root cannot be read back via element.shadowRoot, so tests reach in
// through this module private map instead of loosening the mode.
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

function relativeCheckedTime(generatedAt: number, now: number): string {
  const elapsedMs = now - generatedAt;
  if (elapsedMs < 60_000) {
    return "checked just now";
  }
  const minutes = Math.round(elapsedMs / 60_000);
  if (minutes < 60) {
    return `checked ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.round(minutes / 60);
  return `checked ${hours} hour${hours === 1 ? "" : "s"} ago`;
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

  render(report: Report, rosetteInput: RosetteInput, now: number = Date.now()): void {
    this.report = report;
    const root = shadowRoots.get(this);
    if (root === undefined) {
      return;
    }

    const params = rosetteParams(rosetteInput);
    const path = rosettePath(params, 44);
    const bandLabel = BAND_LABELS[report.band];
    const reducedMotion = prefersReducedMotion();

    root.innerHTML = `
      <style>${DESIGN_TOKENS_CSS}${PANEL_CSS}</style>
      <div class="panel" role="region" aria-label="Verdict report">
        <header>
          <span class="wordmark">verdict</span>
          <button type="button" class="close" aria-label="Close">&times;</button>
        </header>

        <div class="headline">
          <svg
            class="rosette"
            viewBox="-50 -50 100 100"
            role="img"
            aria-labelledby="rosette-alt"
          >
            <title id="rosette-alt">${bandLabel}, estimated ${Math.round(
              report.estimatedInorganicShare * 100,
            )} percent of reviews are inorganic</title>
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
              <dd class="adjusted">${report.adjustedRating.toFixed(1)}</dd>
              <dt>adjusted</dt>
            </div>
            <div>
              <dd class="claimed">${report.claimedRating.toFixed(1)}</dd>
              <dt>claimed</dt>
            </div>
          </dl>
        </div>

        <p class="summary">
          ${bandLabel}. ${report.excludedReviewCount.toLocaleString()} of
          ${report.totalReviewCount.toLocaleString()} reviews look inorganic.
        </p>

        <div
          class="specimen-strip"
          role="img"
          aria-label="${(report.totalReviewCount - report.excludedReviewCount).toLocaleString()}
            reviews kept, ${report.excludedReviewCount.toLocaleString()} reviews excluded"
        >
          <div class="kept" style="flex-grow: ${
            report.totalReviewCount - report.excludedReviewCount
          }"></div>
          <div class="excluded" style="flex-grow: ${report.excludedReviewCount}"></div>
        </div>
        <div class="specimen-labels">
          <span>kept ${(report.totalReviewCount - report.excludedReviewCount).toLocaleString()}</span>
          <span>excluded ${report.excludedReviewCount.toLocaleString()}</span>
        </div>

        <div class="evidence">
          <h2>evidence</h2>
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
                  <span class="signal">${row.signal}</span>
                  <span class="strength">${row.strength}</span>
                  <span class="disclosure" aria-hidden="true">&gt;</span>
                </button>
                <div class="detail" id="evidence-detail-${index}" hidden>${row.detail}</div>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>

        <footer>
          <span class="checked">${relativeCheckedTime(report.generatedAt, now)}</span>
          <button type="button" class="full-report">full report</button>
        </footer>
      </div>
    `;

    this.wireEvidenceToggles(root);
    this.wireClose(root);

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

// DESIGN.md section 6, "the certificate block": a raised panel on tinted
// ground, a 1px rule, a rosette, tabular figures. section 9 for buttons and
// the evidence row and specimen strip. section 5 for type, using fallbacks
// since the actual woff2 files are not part of this repository yet.
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

footer .full-report {
  color: var(--ink);
  text-decoration: underline;
  text-underline-offset: 2px;
}
`;
