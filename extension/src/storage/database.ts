const DATABASE_NAME = "verdict";
// bumped from 1 to 2 to add graphContributionQueue below. onupgradeneeded's
// own "if not exists, create" guards mean a browser already at version 1
// runs the same handler and only the new store is added; nothing about
// reviewsCache, history, or prefs changes.
const DATABASE_VERSION = 2;

export const STORE_NAMES = {
  reviewsCache: "reviews_cache",
  history: "history",
  prefs: "prefs",
  graphContributionQueue: "graph_contribution_queue",
} as const;

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAMES.reviewsCache)) {
        db.createObjectStore(STORE_NAMES.reviewsCache, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.history)) {
        // autoIncrement avoids key collisions when two entries land in the
        // same millisecond; "timestamp" stays a plain indexed field for
        // ordering and eviction rather than the primary key
        const history = db.createObjectStore(STORE_NAMES.history, {
          keyPath: "id",
          autoIncrement: true,
        });
        history.createIndex("timestamp", "timestamp");
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.prefs)) {
        db.createObjectStore(STORE_NAMES.prefs, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.graphContributionQueue)) {
        // PRIVACY.md section 5: edges wait here for a randomised interval
        // before being sent, so "readyAt" is indexed to let
        // graph/queue.ts ask for exactly the ones due without a full
        // table scan.
        const queue = db.createObjectStore(STORE_NAMES.graphContributionQueue, {
          keyPath: "id",
          autoIncrement: true,
        });
        queue.createIndex("readyAt", "readyAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export type WriteResult = { ok: true } | { ok: false; reason: "quota-exceeded" };

// wraps a store.put call so a QuotaExceededError degrades to a typed result
// instead of an unhandled rejection, matching the project's rule that storage
// failures never block analysis.
export function put(store: IDBObjectStore, value: unknown): Promise<WriteResult> {
  return new Promise((resolve, reject) => {
    let request: IDBRequest;
    try {
      request = store.put(value);
    } catch (error) {
      const quotaResult = fromError(error);
      if (quotaResult) {
        resolve(quotaResult);
      } else {
        reject(error);
      }
      return;
    }
    request.onsuccess = () => resolve({ ok: true });
    request.onerror = () => {
      const quotaResult = fromError(request.error);
      if (quotaResult) {
        resolve(quotaResult);
      } else {
        reject(request.error);
      }
    };
  });
}

function fromError(error: unknown): WriteResult | null {
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return { ok: false, reason: "quota-exceeded" };
  }
  return null;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
