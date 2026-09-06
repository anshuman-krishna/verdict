import { getPref, setPref } from "./prefs";

const HISTORY_ENABLED_KEY = "historyEnabled";

// SPEC.md section 16 lists "history default on/off" as an open question
// for anshuman. true is a placeholder starting value so the options page
// toggle has something to render before that decision is made; it is not
// itself the decision.
const DEFAULT_HISTORY_ENABLED = true;

export async function getHistoryEnabled(): Promise<boolean> {
  const value = await getPref<boolean>(HISTORY_ENABLED_KEY);
  return value ?? DEFAULT_HISTORY_ENABLED;
}

export function setHistoryEnabled(enabled: boolean) {
  return setPref(HISTORY_ENABLED_KEY, enabled);
}

const REPUTATION_LOOKUP_ENABLED_KEY = "reputationLookupEnabled";

// SPEC.md section 4: the reviewer graph service is "opt in, off by
// default". Unlike DEFAULT_HISTORY_ENABLED above, this default is not a
// placeholder standing in for an undecided value, it is what the spec
// already says.
const DEFAULT_REPUTATION_LOOKUP_ENABLED = false;

export async function getReputationLookupEnabled(): Promise<boolean> {
  const value = await getPref<boolean>(REPUTATION_LOOKUP_ENABLED_KEY);
  return value ?? DEFAULT_REPUTATION_LOOKUP_ENABLED;
}

export function setReputationLookupEnabled(enabled: boolean) {
  return setPref(REPUTATION_LOOKUP_ENABLED_KEY, enabled);
}
