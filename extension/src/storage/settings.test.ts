import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { getHistoryEnabled, setHistoryEnabled } from "./settings";

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
});
