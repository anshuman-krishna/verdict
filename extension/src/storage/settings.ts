import { getPref, setPref } from "./prefs";
import { getSyncedBoolean, setSyncedBoolean } from "./syncedBoolean";

const HISTORY_ENABLED_KEY = "historyEnabled";

const DEFAULT_HISTORY_ENABLED = true;

export async function getHistoryEnabled(): Promise<boolean> {
  return getSyncedBoolean(HISTORY_ENABLED_KEY, DEFAULT_HISTORY_ENABLED);
}

export function setHistoryEnabled(enabled: boolean) {
  return setSyncedBoolean(HISTORY_ENABLED_KEY, enabled);
}

const REPUTATION_LOOKUP_ENABLED_KEY = "reputationLookupEnabled";

const DEFAULT_REPUTATION_LOOKUP_ENABLED = false;

export async function getReputationLookupEnabled(): Promise<boolean> {
  const value = await getPref<boolean>(REPUTATION_LOOKUP_ENABLED_KEY);
  return value ?? DEFAULT_REPUTATION_LOOKUP_ENABLED;
}

export function setReputationLookupEnabled(enabled: boolean) {
  return setPref(REPUTATION_LOOKUP_ENABLED_KEY, enabled);
}

const GRAPH_CONTRIBUTION_ENABLED_KEY = "graphContributionEnabled";

const DEFAULT_GRAPH_CONTRIBUTION_ENABLED = false;

export async function getGraphContributionEnabled(): Promise<boolean> {
  const value = await getPref<boolean>(GRAPH_CONTRIBUTION_ENABLED_KEY);
  return value ?? DEFAULT_GRAPH_CONTRIBUTION_ENABLED;
}

export function setGraphContributionEnabled(enabled: boolean) {
  return setPref(GRAPH_CONTRIBUTION_ENABLED_KEY, enabled);
}
