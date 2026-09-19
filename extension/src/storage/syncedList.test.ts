import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { SyncStore } from "./syncedBoolean";
import { getSyncedStrings, setSyncedStrings } from "./syncedList";

function syncStore(initial: Record<string, unknown> = {}): SyncStore & { items: Record<string, unknown> } {
  const items = { ...initial };
  return {
    items,
    get: async (key) => (key in items ? { [key]: items[key] } : {}),
    set: async (values) => {
      Object.assign(items, values);
    },
  };
}

describe("a synced list of strings", () => {
  it("is empty before anything is ever set", async () => {
    await expect(getSyncedStrings("list-empty", syncStore())).resolves.toEqual([]);
  });

  it("round trips, sorted and without duplicates", async () => {
    const store = syncStore();
    await setSyncedStrings("list-round", ["b", "a", "b"], store);
    await expect(getSyncedStrings("list-round", store)).resolves.toEqual(["a", "b"]);
    expect(store.items["list-round"]).toEqual(["a", "b"]);
  });

  it("takes what another browser synced when this one has never set it", async () => {
    const store = syncStore({ "list-synced": ["amazon"] });
    await expect(getSyncedStrings("list-synced", store)).resolves.toEqual(["amazon"]);
    // kept locally after the first read, so sync is asked once
    await expect(getSyncedStrings("list-synced", { ...store, get: async () => ({}) })).resolves
      .toEqual(["amazon"]);
  });

  it("ignores a synced value that is not a list of strings", async () => {
    const store = syncStore({ "list-bad": [1, "amazon"] });
    await expect(getSyncedStrings("list-bad", store)).resolves.toEqual([]);
  });

  it("still keeps the local copy when sync is unavailable", async () => {
    const failing: SyncStore = {
      get: vi.fn().mockRejectedValue(new Error("no sync")),
      set: vi.fn().mockRejectedValue(new Error("no sync")),
    };
    await setSyncedStrings("list-offline", ["amazon"], failing);
    await expect(getSyncedStrings("list-offline", failing)).resolves.toEqual(["amazon"]);
  });
});
