import { effectLine, policyNoticeHeadline, type PolicyChange } from "../privacy/commitments";
import { CHANGELOG_URL } from "../siteLinks";
import { escapeHtml } from "./escape";

export interface PolicyNoticeCallbacks {
  onAcknowledge: () => void;
}

export function policyNoticeMarkup(changes: readonly PolicyChange[], now: number): string {
  const headline = policyNoticeHeadline(changes, now);
  if (headline === null) {
    return "";
  }
  const items = changes
    .map(
      (change) =>
        `<li><p>${escapeHtml(change.summary)}</p><p class="effect">${escapeHtml(effectLine(change, now))}</p></li>`,
    )
    .join("");
  return `
    <section class="policy-notice" role="region" aria-label="Privacy notice">
      <h2>${escapeHtml(headline)}</h2>
      <ul>${items}</ul>
      <p class="actions">
        <a href="${CHANGELOG_URL}" target="_blank" rel="noreferrer noopener">Read the changelog</a>
        <button type="button" class="policy-ack">Mark as read</button>
      </p>
    </section>
  `;
}

export function bindPolicyNotice(container: ParentNode, callbacks: PolicyNoticeCallbacks): void {
  container.querySelector(".policy-ack")?.addEventListener("click", callbacks.onAcknowledge);
}
