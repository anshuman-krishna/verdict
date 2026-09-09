import { browser } from "wxt/browser";
import { getPref, setPref } from "./prefs";


export interface SyncStore {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

const realSyncStore: SyncStore = {
  get: (key) => browser.storage.sync.get(key),
  set: (items) => browser.storage.sync.set(items),
};

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
  }
}
