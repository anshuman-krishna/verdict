import { browser } from "wxt/browser";
import { getPref, setPref } from "./prefs";
import type { SyncStore } from "./syncedBoolean";

const realSyncStore: SyncStore = {
  get: (key) => browser.storage.sync.get(key),
  set: (items) => browser.storage.sync.set(items),
};

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return null;
  }
  return [...new Set(value as string[])].sort();
}

// the same shape as a synced boolean: the local copy answers, sync fills it the first time
export async function getSyncedStrings(
  key: string,
  syncStore: SyncStore = realSyncStore,
): Promise<string[]> {
  const local = strings(await getPref<unknown>(key));
  if (local !== null) {
    return local;
  }
  try {
    const synced = strings((await syncStore.get(key))[key]);
    if (synced !== null) {
      await setPref(key, synced);
      return synced;
    }
  } catch {
  }
  return [];
}

export async function setSyncedStrings(
  key: string,
  values: readonly string[],
  syncStore: SyncStore = realSyncStore,
): Promise<string[]> {
  const unique = strings([...values]) ?? [];
  await setPref(key, unique);
  try {
    await syncStore.set({ [key]: unique });
  } catch {
  }
  return unique;
}
