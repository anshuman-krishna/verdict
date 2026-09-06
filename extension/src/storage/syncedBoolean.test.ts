import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { getSyncedBoolean, setSyncedBoolean, type SyncStore } from "./syncedBoolean";

function fakeSyncStore(initial: Record<string, unknown> = {}): SyncStore & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
  };
}

describe("getSyncedBoolean", () => {
  it("returns the default when nothing is stored locally or synced", async () => {
    const sync = fakeSyncStore();
    await expect(getSyncedBoolean("freshKey1", true, sync)).resolves.toBe(true);
  });

  it("adopts a synced value, and persists it locally, when there is no local value yet", async () => {
    const sync = fakeSyncStore({ freshKey2: true });
    await expect(getSyncedBoolean("freshKey2", false, sync)).resolves.toBe(true);
    // adopted locally: a second read does not need sync again
    const secondSync = fakeSyncStore();
    await expect(getSyncedBoolean("freshKey2", false, secondSync)).resolves.toBe(true);
  });

  it("prefers the local value over a different synced value, since this device's own choice must win", async () => {
    await setSyncedBoolean("freshKey3", false, fakeSyncStore());
    const sync = fakeSyncStore({ freshKey3: true });
    await expect(getSyncedBoolean("freshKey3", false, sync)).resolves.toBe(false);
    expect(sync.get).not.toHaveBeenCalled();
  });

  it("falls back to the default rather than throwing when the sync store itself fails", async () => {
    const sync: SyncStore = {
      get: vi.fn().mockRejectedValue(new Error("sync unavailable")),
      set: vi.fn(),
    };
    await expect(getSyncedBoolean("freshKey4", true, sync)).resolves.toBe(true);
  });

  it("ignores a non boolean value in the sync store rather than adopting it", async () => {
    const sync = fakeSyncStore({ freshKey5: "not a boolean" });
    await expect(getSyncedBoolean("freshKey5", true, sync)).resolves.toBe(true);
  });
});

describe("setSyncedBoolean", () => {
  it("writes to both the local store and the sync mirror", async () => {
    const sync = fakeSyncStore();
    await setSyncedBoolean("freshKey6", true, sync);
    expect(sync.set).toHaveBeenCalledWith({ freshKey6: true });
    await expect(getSyncedBoolean("freshKey6", false, fakeSyncStore())).resolves.toBe(true);
  });

  it("still persists the local write when the sync mirror fails", async () => {
    const sync: SyncStore = { get: vi.fn(), set: vi.fn().mockRejectedValue(new Error("offline")) };
    await expect(setSyncedBoolean("freshKey7", true, sync)).resolves.toBeUndefined();
    await expect(getSyncedBoolean("freshKey7", false, fakeSyncStore())).resolves.toBe(true);
  });
});
