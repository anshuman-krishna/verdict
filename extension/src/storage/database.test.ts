import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { openDatabase, put, STORE_NAMES } from "./database";

function fakeStore(behavior: (value: unknown) => IDBRequest): IDBObjectStore {
  return { put: behavior } as unknown as IDBObjectStore;
}

function requestThatFails(error: DOMException): IDBRequest {
  const request = {} as IDBRequest;
  queueMicrotask(() => {
    Object.defineProperty(request, "error", { value: error, configurable: true });
    request.onerror?.(new Event("error"));
  });
  return request;
}

function requestThatSucceeds(): IDBRequest {
  const request = {} as IDBRequest;
  queueMicrotask(() => {
    request.onsuccess?.(new Event("success"));
  });
  return request;
}

describe("put", () => {
  it("resolves ok true on a normal write", async () => {
    const store = fakeStore(() => requestThatSucceeds());
    await expect(put(store, { any: "value" })).resolves.toEqual({ ok: true });
  });

  it("degrades to a typed result on a quota exceeded error, rather than throwing", async () => {
    const store = fakeStore(() =>
      requestThatFails(new DOMException("storage full", "QuotaExceededError")),
    );
    await expect(put(store, { any: "value" })).resolves.toEqual({
      ok: false,
      reason: "quota-exceeded",
    });
  });

  it("rejects on an error that is not a quota problem", async () => {
    const store = fakeStore(() => requestThatFails(new DOMException("nope", "DataError")));
    await expect(put(store, { any: "value" })).rejects.toBeInstanceOf(DOMException);
  });

  it("degrades to a typed result when store.put throws synchronously with a quota error", async () => {
    const store = fakeStore(() => {
      throw new DOMException("storage full", "QuotaExceededError");
    });
    await expect(put(store, { any: "value" })).resolves.toEqual({
      ok: false,
      reason: "quota-exceeded",
    });
  });
});

function wipe(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase("verdict");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

function openAt(version: number, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("verdict", version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe("openDatabase", () => {
  it("creates every store on first open", async () => {
    const db = await openDatabase();
    for (const name of Object.values(STORE_NAMES)) {
      expect(db.objectStoreNames.contains(name), name).toBe(true);
    }
    db.close();
  });

  it("adds the watchlist to a database that predates it, keeping the checks in it", async () => {
    await wipe();
    const older = await openAt(3, (db) => {
      db.createObjectStore(STORE_NAMES.reviewsCache, { keyPath: "key" });
      db.createObjectStore(STORE_NAMES.history, { keyPath: "id" }).createIndex(
        "timestamp",
        "timestamp",
      );
      db.createObjectStore(STORE_NAMES.prefs, { keyPath: "key" });
      db.createObjectStore(STORE_NAMES.graphContributionQueue, { keyPath: "id" });
    });
    older
      .transaction(STORE_NAMES.history, "readwrite")
      .objectStore(STORE_NAMES.history)
      .put({ id: 1, title: "checked before the watchlist existed", timestamp: 1 });
    older.close();

    const db = await openDatabase();

    expect(db.objectStoreNames.contains(STORE_NAMES.watchlist)).toBe(true);
    const kept = await new Promise<{ title: string }>((resolve) => {
      const request = db
        .transaction(STORE_NAMES.history, "readonly")
        .objectStore(STORE_NAMES.history)
        .get(1);
      request.onsuccess = () => resolve(request.result as { title: string });
    });
    expect(kept.title).toBe("checked before the watchlist existed");
    db.close();
  });
});
