import { openDatabase, put, requestToPromise, STORE_NAMES, type WriteResult } from "./database";

interface PrefRecord {
  key: string;
  value: unknown;
}

export async function getPref<T>(key: string): Promise<T | null> {
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.prefs, "readonly").objectStore(STORE_NAMES.prefs);
  const record = await requestToPromise<PrefRecord | undefined>(store.get(key));
  return record ? (record.value as T) : null;
}

export async function setPref(key: string, value: unknown): Promise<WriteResult> {
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.prefs, "readwrite").objectStore(STORE_NAMES.prefs);
  const record: PrefRecord = { key, value };
  return put(store, record);
}
