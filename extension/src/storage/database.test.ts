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

describe("openDatabase", () => {
  it("creates all three stores on first open", async () => {
    const db = await openDatabase();
    expect(db.objectStoreNames.contains(STORE_NAMES.reviewsCache)).toBe(true);
    expect(db.objectStoreNames.contains(STORE_NAMES.history)).toBe(true);
    expect(db.objectStoreNames.contains(STORE_NAMES.prefs)).toBe(true);
    db.close();
  });
});
