import { safeThumbnailUrl } from "../extract/sites";
import { parseFeatureVector, type FeatureVector } from "../score/featureVector";
import { parseStoredReport, type Report } from "../score/report";
import { openDatabase, put, requestToPromise, STORE_NAMES } from "./database";
import { HISTORY_CAP, trimHistoryToCap, type HistoryEntry } from "./history";

export interface ImportableEntry {
  timestamp: number;
  title: string;
  thumbnailUrl: string | null;
  report: Report;
  featureVector?: FeatureVector;
  productKey: string | null;
}

export interface ImportSummary {
  added: number;
  duplicates: number;
  rejected: number;
  // beyond what this browser keeps, so they were never written
  skipped: number;
}

export type ImportOutcome =
  | { status: "not-json" }
  | { status: "not-a-history-export" }
  | { status: "ok"; summary: ImportSummary }
  | { status: "quota-exceeded"; summary: ImportSummary };

const MAX_TITLE_LENGTH = 300;
const PRODUCT_KEY = /^[0-9a-f]{64}$/;
// a clock an hour out is a clock, a year out is a file pinning itself to the top of the list
const FUTURE_TOLERANCE_MS = 86_400_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseImportableEntry(value: unknown, now: number): ImportableEntry | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const timestamp = record.timestamp;
  if (
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0 ||
    timestamp > now + FUTURE_TOLERANCE_MS
  ) {
    return null;
  }
  if (typeof record.title !== "string") {
    return null;
  }
  const report = parseStoredReport(record.report);
  if (report === null) {
    return null;
  }
  const featureVector = record.featureVector === undefined
    ? null
    : parseFeatureVector(record.featureVector);
  const productKey = typeof record.productKey === "string" && PRODUCT_KEY.test(record.productKey)
    ? record.productKey
    : null;
  const entry: ImportableEntry = {
    timestamp,
    title: record.title.slice(0, MAX_TITLE_LENGTH),
    // a url from a file is checked here too, not only where it is drawn
    thumbnailUrl: safeThumbnailUrl(
      typeof record.thumbnailUrl === "string" ? record.thumbnailUrl : null,
    ),
    report,
    productKey,
  };
  // a vector that does not parse is dropped, and the check is kept without it
  if (featureVector !== null) {
    entry.featureVector = featureVector;
  }
  return entry;
}

export interface ParsedFile {
  entries: ImportableEntry[];
  rejected: number;
}

export function parseHistoryFile(text: string, now: number): ParsedFile | ImportOutcome {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: "not-json" };
  }
  if (!Array.isArray(value)) {
    return { status: "not-a-history-export" };
  }
  const entries: ImportableEntry[] = [];
  let rejected = 0;
  for (const item of value) {
    const entry = parseImportableEntry(item, now);
    if (entry === null) {
      rejected += 1;
      continue;
    }
    entries.push(entry);
  }
  return { entries, rejected };
}

// the serial is a hash of the listing url and the moment the report was generated
export function identityOf(entry: { report: Report; timestamp: number; title: string }): string {
  return entry.report.serial === ""
    ? `stamp:${entry.timestamp}:${entry.title}`
    : `serial:${entry.report.serial}`;
}

export async function importHistory(text: string, now: number = Date.now()): Promise<ImportOutcome> {
  const parsed = parseHistoryFile(text, now);
  if ("status" in parsed) {
    return parsed;
  }

  const db = await openDatabase();
  const existing = await requestToPromise<HistoryEntry[]>(
    db.transaction(STORE_NAMES.history, "readonly").objectStore(STORE_NAMES.history).getAll(),
  );
  const seen = new Set<string>();
  for (const entry of existing) {
    const report = parseStoredReport(entry.report);
    if (report !== null) {
      seen.add(identityOf({ report, timestamp: entry.timestamp, title: entry.title }));
    }
  }

  const fresh: ImportableEntry[] = [];
  let duplicates = 0;
  for (const entry of parsed.entries) {
    const identity = identityOf(entry);
    if (seen.has(identity)) {
      duplicates += 1;
      continue;
    }
    seen.add(identity);
    fresh.push(entry);
  }

  // the newest survive the cap, so a large file does not arrive as its oldest half
  fresh.sort((a, b) => b.timestamp - a.timestamp);
  const writable = fresh.slice(0, HISTORY_CAP);
  const skipped = fresh.length - writable.length;

  const store = db.transaction(STORE_NAMES.history, "readwrite").objectStore(STORE_NAMES.history);
  let added = 0;
  for (const entry of writable) {
    // no id, so the store assigns one and nothing already here is overwritten
    const result = await put(store, { ...entry });
    if (!result.ok) {
      return {
        status: "quota-exceeded",
        summary: { added, duplicates, rejected: parsed.rejected, skipped },
      };
    }
    added += 1;
  }
  await trimHistoryToCap();

  return {
    status: "ok",
    summary: { added, duplicates, rejected: parsed.rejected, skipped },
  };
}

function countOf(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count.toLocaleString()} ${many}`;
}

export function importResultLine(outcome: ImportOutcome): string {
  if (outcome.status === "not-json") {
    return "That file is not JSON.";
  }
  if (outcome.status === "not-a-history-export") {
    return "That file is not a Verdict history export.";
  }
  const { added, duplicates, rejected, skipped } = outcome.summary;
  const parts: string[] = [];
  parts.push(
    outcome.status === "quota-exceeded"
      ? `Storage filled up after ${countOf(added, "check", "checks")}.`
      : added === 0
        ? "Nothing new in that file."
        : `Added ${countOf(added, "check", "checks")}.`,
  );
  if (duplicates > 0) {
    parts.push(`${countOf(duplicates, "check was", "checks were")} already here.`);
  }
  if (skipped > 0) {
    parts.push(`${countOf(skipped, "check was", "checks were")} beyond the ${HISTORY_CAP} this browser keeps.`);
  }
  if (rejected > 0) {
    parts.push(`${countOf(rejected, "entry", "entries")} could not be read.`);
  }
  return parts.join(" ");
}
