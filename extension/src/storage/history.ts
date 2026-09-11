import type { FeatureVector } from "../score/featureVector";
import { summarizeReport, type Band } from "../score/report";
import { openDatabase, put, requestToPromise, STORE_NAMES, type WriteResult } from "./database";

const HISTORY_CAP = 500;

export interface HistoryEntry {
  id: number;
  timestamp: number;
  title: string;
  thumbnailUrl: string | null;
  report: unknown;
  featureVector?: FeatureVector;
  // the same local hash the reviews cache is keyed by, never the url or the id
  productKey?: string | null;
}

export interface PreviousCheck {
  timestamp: number;
  band: Band | null;
  adjustedRating: number | null;
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
  return entries.sort((a, b) => b.timestamp - a.timestamp || b.id - a.id);
}

// entries written before the key existed belong to no product, so they never match
export async function listChecksOfProduct(
  productKey: string,
  before: number = Number.POSITIVE_INFINITY,
): Promise<PreviousCheck[]> {
  if (productKey === "") {
    return [];
  }
  const entries = await listHistory();
  return entries
    .filter((entry) => entry.productKey === productKey && entry.timestamp < before)
    .map((entry) => {
      const { band, adjustedRating } = summarizeReport(entry.report);
      return { timestamp: entry.timestamp, band, adjustedRating };
    });
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
  const header = "timestamp,title,band,estimatedInorganicShare,thumbnailUrl";
  const rows = entries.map((entry) => {
    const summary = summarizeReport(entry.report);
    return [
      entry.timestamp,
      csvField(entry.title),
      csvField(summary.band ?? ""),
      summary.estimatedInorganicShare ?? "",
      csvField(entry.thumbnailUrl ?? ""),
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

// a product title is written by the seller, and a spreadsheet runs what starts with these
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function csvField(value: string): string {
  const disarmed = FORMULA_LEAD.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(disarmed) || disarmed !== value) {
    return `"${disarmed.replaceAll('"', '""')}"`;
  }
  return disarmed;
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
