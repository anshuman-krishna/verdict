import { getPref, setPref } from "./prefs";
import { getSyncedBoolean, setSyncedBoolean } from "./syncedBoolean";

const HISTORY_ENABLED_KEY = "historyEnabled";

// SPEC.md section 16 lists "history default on/off" as an open question
// for anshuman. true is a placeholder starting value so the options page
// toggle has something to render before that decision is made; it is not
// itself the decision.
const DEFAULT_HISTORY_ENABLED = true;

// SPEC.md section 10: one of the prefs "mirrored to chrome.storage.sync
// where it makes sense" (syncedBoolean.ts explains why this one qualifies
// and reputationLookupEnabled/graphContributionEnabled below do not).
export async function getHistoryEnabled(): Promise<boolean> {
  return getSyncedBoolean(HISTORY_ENABLED_KEY, DEFAULT_HISTORY_ENABLED);
}

export function setHistoryEnabled(enabled: boolean) {
  return setSyncedBoolean(HISTORY_ENABLED_KEY, enabled);
}

const REPUTATION_LOOKUP_ENABLED_KEY = "reputationLookupEnabled";

// SPEC.md section 4: the reviewer graph service is "opt in, off by
// default". Unlike DEFAULT_HISTORY_ENABLED above, this default is not a
// placeholder standing in for an undecided value, it is what the spec
// already says.
const DEFAULT_REPUTATION_LOOKUP_ENABLED = false;

// deliberately not a synced pref, unlike historyEnabled above:
// syncedBoolean.ts's own comment explains why a permission gated toggle
// is not "where it makes sense" for chrome.storage.sync.
export async function getReputationLookupEnabled(): Promise<boolean> {
  const value = await getPref<boolean>(REPUTATION_LOOKUP_ENABLED_KEY);
  return value ?? DEFAULT_REPUTATION_LOOKUP_ENABLED;
}

export function setReputationLookupEnabled(enabled: boolean) {
  return setPref(REPUTATION_LOOKUP_ENABLED_KEY, enabled);
}

const GRAPH_CONTRIBUTION_ENABLED_KEY = "graphContributionEnabled";

// PRIVACY.md section 5: "opt in contribution", off by default, a
// separate switch from reputationLookupEnabled above. Asking whether a
// reviewer is flagged (section 4) and contributing edges that help build
// the graph in the first place (section 5) are two different consents:
// someone can want one without the other.
const DEFAULT_GRAPH_CONTRIBUTION_ENABLED = false;

export async function getGraphContributionEnabled(): Promise<boolean> {
  const value = await getPref<boolean>(GRAPH_CONTRIBUTION_ENABLED_KEY);
  return value ?? DEFAULT_GRAPH_CONTRIBUTION_ENABLED;
}

export function setGraphContributionEnabled(enabled: boolean) {
  return setPref(GRAPH_CONTRIBUTION_ENABLED_KEY, enabled);
}
