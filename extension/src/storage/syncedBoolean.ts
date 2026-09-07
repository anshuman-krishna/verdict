import { browser } from "wxt/browser";
import { getPref, setPref } from "./prefs";

// indexeddb stays the source of truth; sync is a best effort seed for a new device.
// not used for the two opt ins: each needs a host permission granted on this device, so a synced
// "true" would show a checkbox as on while doing nothing

export interface SyncStore {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

const realSyncStore: SyncStore = {
  get: (key) => browser.storage.sync.get(key),
  set: (items) => browser.storage.sync.set(items),
};

// local always wins: sync only ever seeds a device that never set this preference
export async function getSyncedBoolean(
  key: string,
  defaultValue: boolean,
  syncStore: SyncStore = realSyncStore,
): Promise<boolean> {
  const local = await getPref<boolean>(key);
  if (local !== null) {
    return local;
  }
  try {
    const synced = await syncStore.get(key);
    const value = synced[key];
    if (typeof value === "boolean") {
      await setPref(key, value);
      return value;
    }
  } catch {
    // chrome.storage.sync can fail (offline, quota, sync disabled on
    // this profile); the local default below is a complete, correct
    // answer on its own, so a mirror failure is never a reason to block.
  }
  return defaultValue;
}

export async function setSyncedBoolean(
  key: string,
  value: boolean,
  syncStore: SyncStore = realSyncStore,
): Promise<void> {
  await setPref(key, value);
  try {
    await syncStore.set({ [key]: value });
  } catch {
    // best effort only: the local write above is what actually governs
    // this device regardless of whether the mirror succeeds.
  }
}
