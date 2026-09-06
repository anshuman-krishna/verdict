import { browser } from "wxt/browser";
import { getPref, setPref } from "./prefs";

// SPEC.md section 10: "prefs mirrored to chrome.storage.sync where it
// makes sense." IndexedDB (prefs.ts) stays the source of truth this
// device actually acts on; chrome.storage.sync is a best effort mirror
// so a preference set on one signed in browser shows up as the starting
// point on another, rather than every new device defaulting cold.
//
// Deliberately not used for reputationLookupEnabled or
// graphContributionEnabled (settings.ts): both require a granted host
// permission on the device that turns them on (reputation/permission.ts,
// graph/permission.ts), and adopting a synced "true" here would show a
// checkbox as on without that device ever having granted anything,
// which would look enabled while silently doing nothing. historyEnabled
// has no such coupling, which is what makes it "where it makes sense"
// and the other two not.

export interface SyncStore {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

const realSyncStore: SyncStore = {
  get: (key) => browser.storage.sync.get(key),
  set: (items) => browser.storage.sync.set(items),
};

// local always wins when it exists: this device's own choice, made here,
// should never be silently overwritten by a value from elsewhere just
// because a sync round happens to land. Sync is only ever consulted to
// seed a device that has never set this preference at all.
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
