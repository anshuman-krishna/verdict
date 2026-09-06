import { DESIGN_TOKENS_CSS } from "./tokens";

// SPEC.md section 13's failure table has an exact line for this: "extraction
// yields under 30 reviews: not enough data to judge, no score, no error
// styling." DESIGN.md's panel mock only covers a scored report, so this is
// a second, much smaller custom element rather than a new mode on
// VerdictPanelElement: a certificate block with nothing to certify is not
// a certificate block. Same closed shadow root pattern as panel.ts, for
// the same reason (DESIGN.md section 11, a hostile host page stylesheet
// must not be able to make verdict say something it does not say).

const shadowRoots = new WeakMap<VerdictNoticeElement, ShadowRoot>();

export function getNoticeShadowRootForTesting(notice: VerdictNoticeElement): ShadowRoot {
  const root = shadowRoots.get(notice);
  if (root === undefined) {
    throw new Error("notice has not been constructed");
  }
  return root;
}

export interface NoticeAction {
  label: string;
  onClick: () => void;
  // shown in place of the label while an action (checking more deeply) is
  // in flight, so a slow fetch does not read as a dead button.
  pendingLabel?: string;
}

export interface NoticeState {
  message: string;
  action?: NoticeAction;
  busy?: boolean;
}

export class VerdictNoticeElement extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: "closed" });
    shadowRoots.set(this, root);
  }

  render(state: NoticeState): void {
    const root = shadowRoots.get(this);
    if (root === undefined) {
      return;
    }

    const action = state.action;
    const busy = state.busy ?? false;
    const actionLabel = action
      ? (busy ? (action.pendingLabel ?? action.label) : action.label)
      : null;

    root.innerHTML = `
      <style>${DESIGN_TOKENS_CSS}${NOTICE_CSS}</style>
      <div class="notice" role="status">
        <span class="wordmark">verdict</span>
        <p class="message">${escapeHtml(state.message)}</p>
        <div class="actions">
          ${action ? `<button type="button" class="action" ${busy ? "disabled" : ""}>${escapeHtml(actionLabel as string)}</button>` : ""}
          <button type="button" class="close" aria-label="Close">&times;</button>
        </div>
      </div>
    `;

    if (action) {
      root.querySelector(".action")?.addEventListener("click", action.onClick);
    }
    root.querySelector(".close")?.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("verdict:close", { bubbles: true, composed: true }));
    });
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if (typeof customElements !== "undefined" && customElements.get("verdict-notice") === undefined) {
  customElements.define("verdict-notice", VerdictNoticeElement);
}

const NOTICE_CSS = `
* { box-sizing: border-box; }

.notice {
  width: 280px;
  background: var(--paper-raised);
  color: var(--ink);
  border: 1px solid var(--rule);
  border-radius: 2px 2px 0 0;
  font-family: "Public Sans", system-ui, sans-serif;
  font-size: 0.9375rem;
  line-height: 1.5;
  padding: 12px 16px;
}

.wordmark {
  font-family: "Bricolage Grotesque", system-ui, sans-serif;
  font-weight: 600;
}

.message {
  margin: 8px 0 0;
  color: var(--ink-soft);
}

.actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

button.action {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

button.action:disabled {
  cursor: default;
  opacity: 0.6;
  text-decoration: none;
}

button.close {
  font-size: 1.125rem;
  line-height: 1;
  margin-left: auto;
}

button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
`;
