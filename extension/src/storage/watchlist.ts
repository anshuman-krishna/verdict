import { compareReadings, type WatchChange } from "../watchlist/drift";
import { parseReading, type WatchReading } from "../watchlist/reading";
import { openDatabase, put, requestToPromise, STORE_NAMES, type WriteResult } from "./database";

// a watchlist is something you tend, so it is small on purpose
export const WATCHLIST_CAP = 50;

export interface WatchEntry {
  // the same local hash the reviews cache is keyed by, never the url or the id
  productKey: string;
  site: string;
  title: string;
  thumbnailUrl: string | null;
  savedAt: number;
  lastSeenAt: number;
  checkCount: number;
  // what it read when you saved it, which every later check is compared against
  baseline: WatchReading;
  latest: WatchReading;
}

export interface WatchStatus {
  watching: boolean;
  entry: WatchEntry | null;
  changes: WatchChange[];
}

export const NOT_WATCHED: WatchStatus = { watching: false, entry: null, changes: [] };

export function statusOf(entry: WatchEntry | null): WatchStatus {
  if (entry === null) {
    return NOT_WATCHED;
  }
  return { watching: true, entry, changes: compareReadings(entry.baseline, entry.latest) };
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDatabase();
  return db.transaction(STORE_NAMES.watchlist, mode).objectStore(STORE_NAMES.watchlist);
}

export async function readWatch(productKey: string): Promise<WatchEntry | null> {
  if (productKey === "") {
    return null;
  }
  const found = await requestToPromise<unknown>((await store("readonly")).get(productKey));
  return parseEntry(found);
}

export async function listWatchlist(): Promise<WatchEntry[]> {
  const entries = await requestToPromise<unknown[]>((await store("readonly")).getAll());
  return entries
    .map(parseEntry)
    .filter((entry): entry is WatchEntry => entry !== null)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export interface WatchListing {
  productKey: string;
  site: string;
  title: string;
  thumbnailUrl: string | null;
  reading: WatchReading;
}

export async function watchListing(
  listing: WatchListing,
  now: number = Date.now(),
): Promise<WriteResult> {
  if (listing.productKey === "") {
    return { ok: true };
  }
  const existing = await readWatch(listing.productKey);
  const entry: WatchEntry = {
    productKey: listing.productKey,
    site: listing.site,
    title: listing.title,
    thumbnailUrl: listing.thumbnailUrl,
    // saving again starts the comparison over, which is what saving it again means
    savedAt: now,
    lastSeenAt: now,
    checkCount: existing === null ? 1 : existing.checkCount + 1,
    baseline: listing.reading,
    latest: listing.reading,
  };
  const result = await put(await store("readwrite"), entry);
  if (result.ok) {
    await evictBeyondCap();
  }
  return result;
}

export async function unwatchListing(productKey: string): Promise<void> {
  await requestToPromise((await store("readwrite")).delete(productKey));
}

// a check of something already watched moves the latest reading, never the baseline
export async function recordWatchedCheck(
  productKey: string,
  reading: WatchReading,
  now: number = Date.now(),
): Promise<WatchStatus> {
  const existing = await readWatch(productKey);
  if (existing === null) {
    return NOT_WATCHED;
  }
  const updated: WatchEntry = {
    ...existing,
    lastSeenAt: now,
    checkCount: existing.checkCount + 1,
    latest: reading,
  };
  await put(await store("readwrite"), updated);
  return statusOf(updated);
}

export async function countWatchlist(): Promise<number> {
  return requestToPromise<number>((await store("readonly")).count());
}

export async function deleteAllWatchlist(): Promise<void> {
  await requestToPromise((await store("readwrite")).clear());
}

async function evictBeyondCap(): Promise<number> {
  const entries = await listWatchlist();
  if (entries.length <= WATCHLIST_CAP) {
    return 0;
  }
  const writable = await store("readwrite");
  const doomed = entries.slice(WATCHLIST_CAP);
  for (const entry of doomed) {
    await requestToPromise(writable.delete(entry.productKey));
  }
  return doomed.length;
}

function parseEntry(value: unknown): WatchEntry | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const baseline = parseReading(record.baseline);
  const latest = parseReading(record.latest) ?? baseline;
  if (typeof record.productKey !== "string" || record.productKey === "" || baseline === null) {
    return null;
  }
  return {
    productKey: record.productKey,
    site: typeof record.site === "string" ? record.site : "",
    title: typeof record.title === "string" ? record.title : "",
    thumbnailUrl: typeof record.thumbnailUrl === "string" ? record.thumbnailUrl : null,
    savedAt: typeof record.savedAt === "number" ? record.savedAt : baseline.at,
    lastSeenAt: typeof record.lastSeenAt === "number" ? record.lastSeenAt : baseline.at,
    checkCount: typeof record.checkCount === "number" ? record.checkCount : 1,
    baseline,
    latest: latest as WatchReading,
  };
}
