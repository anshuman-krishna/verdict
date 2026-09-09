const DATABASE_NAME = "verdict";
const DATABASE_VERSION = 3;

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
      } else if (request.transaction !== null) {
        request.transaction.objectStore(STORE_NAMES.reviewsCache).clear();
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.history)) {
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
