export interface PolicyChange {
  version: number;
  // the day it starts applying, so there is a window in which to read it first
  effectiveAt: number;
  summary: string;
}

// PRIVACY.md section 9: nothing about what leaves this browser changes without a
// version bump, a changelog entry, and a notice here, before it takes effect.
// Empty is the correct state for a build that has changed none of it.
export const POLICY_CHANGES: readonly PolicyChange[] = [];

export const PRIVACY_POLICY_VERSION = POLICY_CHANGES.reduce(
  (highest, change) => Math.max(highest, change.version),
  0,
);

export function pendingPolicyChanges(
  acknowledgedVersion: number,
  changes: readonly PolicyChange[] = POLICY_CHANGES,
): PolicyChange[] {
  return changes
    .filter((change) => change.version > acknowledgedVersion)
    .sort((a, b) => a.version - b.version);
}

export function highestVersion(changes: readonly PolicyChange[]): number {
  return changes.reduce((highest, change) => Math.max(highest, change.version), 0);
}

function formatDay(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function effectLine(change: PolicyChange, now: number): string {
  const day = formatDay(change.effectiveAt);
  return change.effectiveAt > now ? `Takes effect on ${day}.` : `In effect since ${day}.`;
}

export function policyNoticeHeadline(
  changes: readonly PolicyChange[],
  now: number,
): string | null {
  if (changes.length === 0) {
    return null;
  }
  const anyPending = changes.some((change) => change.effectiveAt > now);
  return anyPending
    ? "What Verdict does with your data is changing."
    : "What Verdict does with your data has changed.";
}

// a version that does not rise past what a user already acknowledged is a change
// nobody is ever shown, so the shipped list is checked rather than trusted
export function commitmentProblems(changes: readonly PolicyChange[]): string[] {
  const problems: string[] = [];
  let previous: PolicyChange | null = null;
  for (const change of changes) {
    if (!Number.isInteger(change.version) || change.version < 1) {
      problems.push(`version ${String(change.version)} is not a positive whole number`);
    }
    if (!Number.isFinite(change.effectiveAt)) {
      problems.push(`version ${String(change.version)} has no effective date`);
    }
    if (change.summary.trim() === "") {
      problems.push(`version ${String(change.version)} says nothing`);
    }
    if (previous !== null && change.version <= previous.version) {
      problems.push(`version ${change.version} does not follow version ${previous.version}`);
    }
    if (previous !== null && change.effectiveAt < previous.effectiveAt) {
      problems.push(`version ${change.version} takes effect before version ${previous.version}`);
    }
    previous = change;
  }
  return problems;
}
