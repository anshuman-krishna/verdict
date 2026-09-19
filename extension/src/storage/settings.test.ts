import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import {
  getGraphContributionEnabled,
  getHistoryEnabled,
  getReputationLookupEnabled,
  setGraphContributionEnabled,
  setHistoryEnabled,
  setReputationLookupEnabled,
  getAcknowledgedPolicyVersion,
  setAcknowledgedPolicyVersion,
  getAnalysisEnabled,
  setAnalysisEnabled,
  getPausedSites,
  setSitePaused,
  isAnalysisAllowedOn,
} from "./settings";

describe("settings", () => {
  it("defaults to enabled before anything is ever set", async () => {
    await expect(getHistoryEnabled()).resolves.toBe(true);
  });

  it("round trips a stored value", async () => {
    await setHistoryEnabled(false);
    await expect(getHistoryEnabled()).resolves.toBe(false);

    await setHistoryEnabled(true);
    await expect(getHistoryEnabled()).resolves.toBe(true);
  });

  it("mirrors historyEnabled to chrome.storage.sync, per SPEC.md section 10", async () => {
    await setHistoryEnabled(false);
    await expect(browser.storage.sync.get("historyEnabled")).resolves.toEqual({
      historyEnabled: false,
    });
  });

  it("defaults reputation lookup to disabled, per SPEC.md section 4", async () => {
    await expect(getReputationLookupEnabled()).resolves.toBe(false);
  });

  it("round trips a stored reputation lookup preference", async () => {
    await setReputationLookupEnabled(true);
    await expect(getReputationLookupEnabled()).resolves.toBe(true);

    await setReputationLookupEnabled(false);
    await expect(getReputationLookupEnabled()).resolves.toBe(false);
  });

  it("defaults graph contribution to disabled, per PRIVACY.md section 5", async () => {
    await expect(getGraphContributionEnabled()).resolves.toBe(false);
  });

  it("round trips a stored graph contribution preference", async () => {
    await setGraphContributionEnabled(true);
    await expect(getGraphContributionEnabled()).resolves.toBe(true);

    await setGraphContributionEnabled(false);
    await expect(getGraphContributionEnabled()).resolves.toBe(false);
  });
});

describe("the acknowledged privacy policy version", () => {
  it("is zero before anything is acknowledged, so a change is shown rather than skipped", async () => {
    await expect(getAcknowledgedPolicyVersion()).resolves.toBe(0);
  });

  it("round trips", async () => {
    await setAcknowledgedPolicyVersion(4);
    await expect(getAcknowledgedPolicyVersion()).resolves.toBe(4);
  });

  it("treats a value that is not a whole count as nothing acknowledged", async () => {
    await setAcknowledgedPolicyVersion(-1);
    await expect(getAcknowledgedPolicyVersion()).resolves.toBe(0);
    await setAcknowledgedPolicyVersion(2.5);
    await expect(getAcknowledgedPolicyVersion()).resolves.toBe(0);
  });
});


describe("whether verdict reads the pages a reader opens", () => {
  it("reads them until somebody says otherwise", async () => {
    await expect(getAnalysisEnabled()).resolves.toBe(true);
    await expect(getPausedSites()).resolves.toEqual([]);
    await expect(isAnalysisAllowedOn("amazon")).resolves.toBe(true);
  });

  it("stops everywhere when the switch is off", async () => {
    await setAnalysisEnabled(false);
    await expect(isAnalysisAllowedOn("amazon")).resolves.toBe(false);
    await expect(isAnalysisAllowedOn("google-maps")).resolves.toBe(false);
    await setAnalysisEnabled(true);
  });

  it("mirrors the switch to chrome.storage.sync, so it follows the reader", async () => {
    await setAnalysisEnabled(false);
    await expect(browser.storage.sync.get("analysisEnabled")).resolves.toEqual({
      analysisEnabled: false,
    });
    await setAnalysisEnabled(true);
  });

  it("pauses one platform without touching the others", async () => {
    await setSitePaused("google-maps", true);
    await expect(getPausedSites()).resolves.toEqual(["google-maps"]);
    await expect(isAnalysisAllowedOn("google-maps")).resolves.toBe(false);
    await expect(isAnalysisAllowedOn("amazon")).resolves.toBe(true);
  });

  it("does not list the same platform twice, however many times it is paused", async () => {
    await setSitePaused("amazon", true);
    await setSitePaused("amazon", true);
    await expect(getPausedSites()).resolves.toEqual(["amazon", "google-maps"]);
  });

  it("starts reading a platform again when it is unpaused", async () => {
    await setSitePaused("amazon", false);
    await setSitePaused("google-maps", false);
    await expect(getPausedSites()).resolves.toEqual([]);
    await expect(isAnalysisAllowedOn("amazon")).resolves.toBe(true);
  });

  it("mirrors the paused platforms to chrome.storage.sync too", async () => {
    await setSitePaused("amazon", true);
    await expect(browser.storage.sync.get("pausedSites")).resolves.toEqual({
      pausedSites: ["amazon"],
    });
    await setSitePaused("amazon", false);
  });
});
