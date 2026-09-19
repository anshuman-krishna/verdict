import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { WatchReading } from "../watchlist/reading";
import { openDatabase, requestToPromise, STORE_NAMES } from "./database";
import {
  countWatchlist,
  deleteAllWatchlist,
  listWatchlist,
  readWatch,
  recordWatchedCheck,
  statusOf,
  unwatchListing,
  watchListing,
  WATCHLIST_CAP,
} from "./watchlist";

const NOW = Date.parse("2026-03-01T12:00:00Z");
const LATER = NOW + 86_400_000 * 7;

function reading(overrides: Partial<WatchReading> = {}): WatchReading {
  return {
    at: NOW,
    band: "mostly-clean",
    probability: 0.2,
    claimedRating: 4.6,
    adjustedRating: 4.4,
    totalReviewCount: 400,
    features: { "temporalBurst.largestBurstShare": 0.05 },
    ...overrides,
  };
}

function listing(productKey = "key-1", title = "a stovetop kettle") {
  return { productKey, site: "amazon", title, thumbnailUrl: null, reading: reading() };
}

async function writeRaw(row: Record<string, unknown>): Promise<void> {
  const db = await openDatabase();
  const store = db.transaction(STORE_NAMES.watchlist, "readwrite").objectStore(
    STORE_NAMES.watchlist,
  );
  await requestToPromise(store.put(row));
}

describe("the watchlist", () => {
  beforeEach(async () => {
    await deleteAllWatchlist();
  });

  it("starts empty", async () => {
    await expect(listWatchlist()).resolves.toEqual([]);
    await expect(countWatchlist()).resolves.toBe(0);
  });

  it("keeps a listing under the local key, never the url", async () => {
    await watchListing(listing(), NOW);

    const entry = await readWatch("key-1");
    expect(entry?.title).toBe("a stovetop kettle");
    expect(entry?.savedAt).toBe(NOW);
    expect(entry?.baseline).toEqual(entry?.latest);
    expect(JSON.stringify(entry)).not.toContain("http");
  });

  it("has nothing for a listing it was never given", async () => {
    await expect(readWatch("nothing")).resolves.toBeNull();
    await expect(readWatch("")).resolves.toBeNull();
  });

  it("moves the latest reading on a later check and leaves the baseline alone", async () => {
    await watchListing(listing(), NOW);

    const status = await recordWatchedCheck("key-1", reading({ at: LATER, band: "doubtful" }), LATER);

    expect(status.watching).toBe(true);
    expect(status.changes).toEqual([{ kind: "band", from: "mostly-clean", to: "doubtful" }]);
    const entry = await readWatch("key-1");
    expect(entry?.baseline.band).toBe("mostly-clean");
    expect(entry?.latest.band).toBe("doubtful");
    expect(entry?.lastSeenAt).toBe(LATER);
    expect(entry?.checkCount).toBe(2);
  });

  it("records nothing for a listing nobody is watching", async () => {
    const status = await recordWatchedCheck("key-1", reading(), LATER);

    expect(status).toEqual({ watching: false, entry: null, changes: [] });
    await expect(countWatchlist()).resolves.toBe(0);
  });

  it("saving it again starts the comparison from today", async () => {
    await watchListing(listing(), NOW);
    await recordWatchedCheck("key-1", reading({ at: LATER, band: "doubtful" }), LATER);

    await watchListing(
      { ...listing(), reading: reading({ at: LATER, band: "doubtful" }) },
      LATER,
    );

    const entry = await readWatch("key-1");
    expect(entry?.savedAt).toBe(LATER);
    expect(entry?.baseline.band).toBe("doubtful");
    expect(statusOf(entry).changes).toEqual([]);
  });

  it("stops watching what it is told to stop watching", async () => {
    await watchListing(listing(), NOW);
    await watchListing(listing("key-2", "a cable"), NOW);

    await unwatchListing("key-1");

    expect((await listWatchlist()).map((entry) => entry.title)).toEqual(["a cable"]);
  });

  it("lists what was saved most recently first", async () => {
    await watchListing(listing("key-1", "first"), NOW);
    await watchListing(listing("key-2", "second"), NOW + 1000);

    expect((await listWatchlist()).map((entry) => entry.title)).toEqual(["second", "first"]);
  });

  it("drops the oldest once the cap is passed, because a watchlist is tended", async () => {
    for (let i = 0; i < WATCHLIST_CAP + 2; i++) {
      await watchListing(listing(`key-${i}`, `listing ${i}`), NOW + i);
    }

    const entries = await listWatchlist();
    expect(entries).toHaveLength(WATCHLIST_CAP);
    expect(entries.some((entry) => entry.title === "listing 0")).toBe(false);
  });

  it("refuses a listing with no key rather than writing a row nothing can find", async () => {
    await watchListing(listing(""), NOW);

    await expect(countWatchlist()).resolves.toBe(0);
  });

  it("reads a row written by a build that stored less than this one", async () => {
    await writeRaw({
      productKey: "key-1",
      title: "an older row",
      baseline: { at: NOW, band: "mixed" },
    });

    const entry = await readWatch("key-1");
    expect(entry?.checkCount).toBe(1);
    expect(entry?.savedAt).toBe(NOW);
    expect(entry?.latest).toEqual(entry?.baseline);
    expect(entry?.thumbnailUrl).toBeNull();
    expect(statusOf(entry).changes).toEqual([]);
  });

  it("passes over a row it cannot make sense of rather than failing the list", async () => {
    await watchListing(listing(), NOW);
    await writeRaw({ productKey: "broken" });

    expect((await listWatchlist()).map((entry) => entry.productKey)).toEqual(["key-1"]);
  });

  it("has no status for a listing nobody saved", () => {
    expect(statusOf(null)).toEqual({ watching: false, entry: null, changes: [] });
  });
});
