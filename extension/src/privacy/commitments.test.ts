import { describe, expect, it } from "vitest";
import {
  commitmentProblems,
  effectLine,
  highestVersion,
  pendingPolicyChanges,
  policyNoticeHeadline,
  POLICY_CHANGES,
  PRIVACY_POLICY_VERSION,
  type PolicyChange,
} from "./commitments";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 2, 1);

function change(overrides: Partial<PolicyChange> = {}): PolicyChange {
  return {
    version: 1,
    effectiveAt: NOW + 30 * DAY_MS,
    summary: "Reputation lookups will batch across tabs.",
    ...overrides,
  };
}

describe("the shipped commitments", () => {
  it("changes nothing about what leaves the browser", () => {
    expect(POLICY_CHANGES).toEqual([]);
    expect(PRIVACY_POLICY_VERSION).toBe(0);
  });

  it("passes its own structural check", () => {
    expect(commitmentProblems(POLICY_CHANGES)).toEqual([]);
  });
});

describe("pendingPolicyChanges", () => {
  it("returns nothing when the acknowledged version is current", () => {
    const changes = [change({ version: 1 }), change({ version: 2 })];
    expect(pendingPolicyChanges(2, changes)).toEqual([]);
  });

  it("returns only what came after the acknowledged version", () => {
    const changes = [change({ version: 1 }), change({ version: 2 }), change({ version: 3 })];
    expect(pendingPolicyChanges(1, changes).map((c) => c.version)).toEqual([2, 3]);
  });

  it("returns everything when nothing was ever acknowledged", () => {
    const changes = [change({ version: 1 }), change({ version: 2 })];
    expect(pendingPolicyChanges(0, changes)).toHaveLength(2);
  });

  it("orders by version rather than by the order they were written", () => {
    const changes = [change({ version: 3 }), change({ version: 1 }), change({ version: 2 })];
    expect(pendingPolicyChanges(0, changes).map((c) => c.version)).toEqual([1, 2, 3]);
  });
});

describe("effectLine", () => {
  it("says when a change is still to come", () => {
    const line = effectLine(change({ effectiveAt: NOW + DAY_MS }), NOW);
    expect(line).toMatch(/^Takes effect on /);
  });

  it("says since when a change already applies", () => {
    const line = effectLine(change({ effectiveAt: NOW - DAY_MS }), NOW);
    expect(line).toMatch(/^In effect since /);
  });

  it("treats the exact moment it takes effect as in effect", () => {
    expect(effectLine(change({ effectiveAt: NOW }), NOW)).toMatch(/^In effect since /);
  });
});

describe("policyNoticeHeadline", () => {
  it("is null when there is nothing to say", () => {
    expect(policyNoticeHeadline([], NOW)).toBeNull();
  });

  it("uses the future tense while any change is still to come", () => {
    const changes = [change({ effectiveAt: NOW - DAY_MS }), change({ effectiveAt: NOW + DAY_MS })];
    expect(policyNoticeHeadline(changes, NOW)).toBe(
      "What Verdict does with your data is changing.",
    );
  });

  it("uses the past tense once every change applies", () => {
    const changes = [change({ effectiveAt: NOW - DAY_MS })];
    expect(policyNoticeHeadline(changes, NOW)).toBe(
      "What Verdict does with your data has changed.",
    );
  });
});

describe("highestVersion", () => {
  it("is zero for an empty list", () => {
    expect(highestVersion([])).toBe(0);
  });

  it("is the largest version present, whatever the order", () => {
    expect(highestVersion([change({ version: 3 }), change({ version: 1 })])).toBe(3);
  });
});

describe("commitmentProblems", () => {
  it("accepts an ascending list", () => {
    const changes = [
      change({ version: 1, effectiveAt: NOW }),
      change({ version: 2, effectiveAt: NOW + DAY_MS }),
    ];
    expect(commitmentProblems(changes)).toEqual([]);
  });

  it("rejects a version that does not rise, which nobody would ever be shown", () => {
    const changes = [change({ version: 2 }), change({ version: 2 })];
    expect(commitmentProblems(changes)).toContain("version 2 does not follow version 2");
  });

  it("rejects an effective date that moves backwards", () => {
    const changes = [
      change({ version: 1, effectiveAt: NOW + DAY_MS }),
      change({ version: 2, effectiveAt: NOW }),
    ];
    expect(commitmentProblems(changes)).toContain("version 2 takes effect before version 1");
  });

  it("rejects a change that says nothing", () => {
    expect(commitmentProblems([change({ summary: "   " })])).toContain("version 1 says nothing");
  });

  it("rejects a version that is not a positive whole number", () => {
    expect(commitmentProblems([change({ version: 0 })])).toContain(
      "version 0 is not a positive whole number",
    );
  });

  it("rejects a change with no effective date", () => {
    expect(commitmentProblems([change({ effectiveAt: Number.NaN })])).toContain(
      "version 1 has no effective date",
    );
  });
});
