import { openDatabase, put, requestToPromise, STORE_NAMES, type WriteResult } from "./database";

const HISTORY_CAP = 500;

export interface HistoryEntry {
  id: number;
  timestamp: number;
  title: string;
  thumbnailUrl: string | null;
  // the report shape is not defined yet, no signal or scoring code exists
  report: unknown;
}

export async function addHistoryEntry(
  entry: Omit<HistoryEntry, "id" | "timestamp">,
): Promise<WriteResult> {
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.history, "readwrite").objectStore(
    STORE_NAMES.history,
  );
  const full: Omit<HistoryEntry, "id"> = { ...entry, timestamp: Date.now() };
  const result = await put(store, full);
  if (result.ok) {
    await evictBeyondCap(db);
  }
  return result;
}

export async function listHistory(): Promise<HistoryEntry[]> {
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.history, "readonly").objectStore(
    STORE_NAMES.history,
  );
  const entries = await requestToPromise<HistoryEntry[]>(store.getAll());
  // id is a strictly increasing insertion order, used to break ties when two
  // entries share a millisecond timestamp
  return entries.sort((a, b) => b.timestamp - a.timestamp || b.id - a.id);
}

export async function deleteAllHistory(): Promise<void> {
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.history, "readwrite").objectStore(
    STORE_NAMES.history,
  );
  await requestToPromise(store.clear());
}

export async function exportHistoryAsJson(): Promise<string> {
  const entries = await listHistory();
  return JSON.stringify(entries, null, 2);
}

export async function exportHistoryAsCsv(): Promise<string> {
  const entries = await listHistory();
  const header = "timestamp,title,thumbnailUrl";
  const rows = entries.map((entry) =>
    [entry.timestamp, csvField(entry.title), csvField(entry.thumbnailUrl ?? "")].join(","),
  );
  return [header, ...rows].join("\n");
}

function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

async function evictBeyondCap(db: IDBDatabase): Promise<void> {
  const store = db.transaction(STORE_NAMES.history, "readwrite").objectStore(
    STORE_NAMES.history,
  );
  const keys = await requestToPromise<number[]>(store.getAllKeys() as IDBRequest<number[]>);
  if (keys.length <= HISTORY_CAP) {
    return;
  }
  const oldestFirst = [...keys].sort((a, b) => a - b);
  const toDeleteCount = oldestFirst.length - HISTORY_CAP;
  for (const key of oldestFirst.slice(0, toDeleteCount)) {
    await requestToPromise(store.delete(key));
  }
}
