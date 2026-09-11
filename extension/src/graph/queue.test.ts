import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { ContributionEdge } from "./edge";
import {
  QUEUE_CAP,
  clearContributionQueue,
  countQueuedContributions,
  deleteContributions,
  enqueueContributionEdges,
  listDueContributions,
  nextContributionDueAt,
} from "./queue";

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

describe("when the service has been unreachable for a long time", () => {
  it("stops adding once the queue is at its cap", async () => {
    await clearQueue();
    const edges = Array.from({ length: 6 }, (_, i) => edge({ weekBucket: 2800 + i }));

    await enqueueContributionEdges(edges, () => 1_000, () => 0, 4);

    expect(await countQueuedContributions()).toBe(4);
  });

  it("adds nothing more once the cap is already reached", async () => {
    await clearQueue();
    await enqueueContributionEdges([edge(), edge()], () => 1_000, () => 0, 2);
    await enqueueContributionEdges([edge()], () => 1_000, () => 0, 2);

    expect(await countQueuedContributions()).toBe(2);
  });

  it("still takes everything while there is room", async () => {
    await clearQueue();
    await enqueueContributionEdges([edge(), edge(), edge()], () => 1_000, () => 0, 10);

    expect(await countQueuedContributions()).toBe(3);
  });

  it("caps high enough that ordinary browsing never reaches it", () => {
    expect(QUEUE_CAP).toBeGreaterThanOrEqual(10_000);
  });
});

describe("nextContributionDueAt", () => {
  it("reports nothing for an empty queue", async () => {
    await clearQueue();
    await expect(nextContributionDueAt()).resolves.toBeNull();
  });

  it("reports the soonest release, not the newest row", async () => {
    await clearQueue();
    await enqueueContributionEdges([edge()], () => 1_000_000, () => 1);
    await enqueueContributionEdges([edge()], () => 1_000_000, () => 0);

    await expect(nextContributionDueAt()).resolves.toBe(1_000_000 + 60 * 60 * 1000);
  });
});

describe("clearContributionQueue", () => {
  it("removes everything waiting, however far out it was scheduled", async () => {
    await clearQueue();
    await enqueueContributionEdges([edge(), edge()], () => 1_000_000, () => 1);

    await clearContributionQueue();

    expect(await countQueuedContributions()).toBe(0);
  });
});
