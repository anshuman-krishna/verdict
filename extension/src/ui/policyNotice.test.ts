// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PolicyChange } from "../privacy/commitments";
import { bindPolicyNotice, policyNoticeMarkup } from "./policyNotice";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 2, 1);

const CHANGE: PolicyChange = {
  version: 1,
  effectiveAt: NOW + 30 * DAY_MS,
  summary: "Reputation lookups will batch across tabs.",
};

describe("policyNoticeMarkup", () => {
  it("is empty when nothing is pending, so the page renders as it always did", () => {
    expect(policyNoticeMarkup([], NOW)).toBe("");
  });

  it("names every pending change and when it applies", () => {
    const markup = policyNoticeMarkup([CHANGE], NOW);
    expect(markup).toContain("Reputation lookups will batch across tabs.");
    expect(markup).toContain("Takes effect on");
  });

  it("links the changelog the privacy page promises", () => {
    expect(policyNoticeMarkup([CHANGE], NOW)).toContain("https://verdict.tools/changelog");
  });

  it("escapes a summary rather than letting it carry markup", () => {
    const hostile = { ...CHANGE, summary: "<img src=x onerror=alert(1)>" };
    const markup = policyNoticeMarkup([hostile], NOW);
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img");
  });

  it("carries a region label so a screen reader reaches it", () => {
    expect(policyNoticeMarkup([CHANGE], NOW)).toContain('aria-label="Privacy notice"');
  });
});

describe("bindPolicyNotice", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.replaceChildren(container);
  });

  it("calls back when the notice is marked as read", () => {
    container.innerHTML = policyNoticeMarkup([CHANGE], NOW);
    const onAcknowledge = vi.fn();
    bindPolicyNotice(container, { onAcknowledge });
    container.querySelector<HTMLButtonElement>(".policy-ack")?.click();
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is no notice to bind", () => {
    container.innerHTML = policyNoticeMarkup([], NOW);
    expect(() => bindPolicyNotice(container, { onAcknowledge: vi.fn() })).not.toThrow();
  });
});
