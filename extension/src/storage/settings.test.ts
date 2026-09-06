import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  getHistoryEnabled,
  getReputationLookupEnabled,
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

  it("defaults reputation lookup to disabled, per SPEC.md section 4", async () => {
    await expect(getReputationLookupEnabled()).resolves.toBe(false);
  });

  it("round trips a stored reputation lookup preference", async () => {
    await setReputationLookupEnabled(true);
    await expect(getReputationLookupEnabled()).resolves.toBe(true);

    await setReputationLookupEnabled(false);
    await expect(getReputationLookupEnabled()).resolves.toBe(false);
  });
});
