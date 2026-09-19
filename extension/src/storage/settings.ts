import { getPref, setPref } from "./prefs";
import { getSyncedBoolean, setSyncedBoolean } from "./syncedBoolean";
import { getSyncedStrings, setSyncedStrings } from "./syncedList";

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

const ACKNOWLEDGED_POLICY_VERSION_KEY = "acknowledgedPolicyVersion";

// local, never synced: a notice shown twice costs nothing, one skipped breaks a promise
export async function getAcknowledgedPolicyVersion(): Promise<number> {
  const value = await getPref<number>(ACKNOWLEDGED_POLICY_VERSION_KEY);
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function setAcknowledgedPolicyVersion(version: number) {
  return setPref(ACKNOWLEDGED_POLICY_VERSION_KEY, version);
}

const ANALYSIS_ENABLED_KEY = "analysisEnabled";

const DEFAULT_ANALYSIS_ENABLED = true;

export async function getAnalysisEnabled(): Promise<boolean> {
  return getSyncedBoolean(ANALYSIS_ENABLED_KEY, DEFAULT_ANALYSIS_ENABLED);
}

export function setAnalysisEnabled(enabled: boolean) {
  return setSyncedBoolean(ANALYSIS_ENABLED_KEY, enabled);
}

const PAUSED_SITES_KEY = "pausedSites";

export function getPausedSites(): Promise<string[]> {
  return getSyncedStrings(PAUSED_SITES_KEY);
}

export async function setSitePaused(site: string, paused: boolean): Promise<string[]> {
  const current = await getPausedSites();
  const next = paused ? [...current, site] : current.filter((entry) => entry !== site);
  return setSyncedStrings(PAUSED_SITES_KEY, next);
}

// what the content script asks before it reads a page: the switch, then this platform
export async function isAnalysisAllowedOn(site: string): Promise<boolean> {
  if (!(await getAnalysisEnabled())) {
    return false;
  }
  return !(await getPausedSites()).includes(site);
}
