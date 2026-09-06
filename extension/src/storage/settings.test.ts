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
