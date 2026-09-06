import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { ContributionEdge } from "./edge";
import {
  countQueuedContributions,
  deleteContributions,
  enqueueContributionEdges,
  listDueContributions,
} from "./queue";

// tests in this file share one fake IndexedDB for the whole file (the
// same convention storage/history.test.ts uses), so each test that needs
// a known starting state clears whatever earlier tests left behind
// first, rather than assuming isolation it does not have.
const FAR_FUTURE = 10_000_000_000_000;

async function clearQueue(): Promise<void> {
  const due = await listDueContributions(FAR_FUTURE);
  await deleteContributions(due.map((d) => d.id));
}

function edge(overrides: Partial<ContributionEdge> = {}): ContributionEdge {
  return {
    reviewerHash: "a".repeat(64),
    productHash: "b".repeat(64),
    starRating: 5,
    weekBucket: 2800,
    verified: true,
    minhashSignature: [],
    ...overrides,
  };
}

describe("enqueueContributionEdges / listDueContributions", () => {
  it("does nothing for an empty batch", async () => {
    await clearQueue();
    await enqueueContributionEdges([]);
    expect(await countQueuedContributions()).toBe(0);
  });

  it("holds a queued edge until its randomised delay elapses, between 1 and 6 hours out", async () => {
    await clearQueue();
    const now = 1_000_000;
    await enqueueContributionEdges([edge()], () => now, () => 0.5);

    expect(await listDueContributions(now)).toEqual([]);
    expect(await listDueContributions(now + 60 * 60 * 1000 - 1)).toEqual([]);

    const dueAt = now + 60 * 60 * 1000 + 0.5 * (6 * 60 * 60 * 1000 - 60 * 60 * 1000);
    const due = await listDueContributions(dueAt);
    expect(due).toHaveLength(1);
    expect(due[0]?.edge).toEqual(edge());
  });

  it("never schedules an edge for release before the 1 hour floor, even with the smallest random draw", async () => {
    await clearQueue();
    const now = 1_000_000;
    await enqueueContributionEdges([edge()], () => now, () => 0);
    expect(await listDueContributions(now + 60 * 60 * 1000 - 1000)).toEqual([]);
    expect(await listDueContributions(now + 60 * 60 * 1000)).toHaveLength(1);
  });

  it("never schedules an edge past the 6 hour ceiling, even with the largest random draw", async () => {
    await clearQueue();
    const now = 1_000_000;
    await enqueueContributionEdges([edge()], () => now, () => 0.999999);
    expect(await listDueContributions(now + 6 * 60 * 60 * 1000)).toHaveLength(1);
  });

  it("returns due edges oldest first", async () => {
    await clearQueue();
    let now = 1_000_000;
    await enqueueContributionEdges([edge({ starRating: 1 })], () => now, () => 0);
    now += 1000;
    await enqueueContributionEdges([edge({ starRating: 2 })], () => now, () => 0);

    const due = await listDueContributions(now + 6 * 60 * 60 * 1000);
    expect(due.map((d) => d.edge.starRating)).toEqual([1, 2]);
  });
});

describe("deleteContributions", () => {
  it("removes queued edges by id so a successful submission does not resend them", async () => {
    await clearQueue();
    await enqueueContributionEdges([edge()], () => 1_000_000, () => 0);
    const due = await listDueContributions(FAR_FUTURE);
    expect(due).toHaveLength(1);

    await deleteContributions(due.map((d) => d.id));
    expect(await countQueuedContributions()).toBe(0);
  });

  it("does nothing for an empty id list", async () => {
    await clearQueue();
    await enqueueContributionEdges([edge()], () => 1_000_000, () => 0);
    await deleteContributions([]);
    expect(await countQueuedContributions()).toBe(1);
  });
});
