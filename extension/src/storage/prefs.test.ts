import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { getPref, setPref } from "./prefs";

describe("prefs", () => {
  it("returns null for a key that was never set", async () => {
    await expect(getPref("never-set")).resolves.toBeNull();
  });

  it("round trips a value through set and get", async () => {
    await setPref("historyEnabled", true);
    await expect(getPref<boolean>("historyEnabled")).resolves.toBe(true);
  });

  it("overwrites a previous value for the same key", async () => {
    await setPref("communityChecks", false);
    await setPref("communityChecks", true);
    await expect(getPref<boolean>("communityChecks")).resolves.toBe(true);
  });
});
