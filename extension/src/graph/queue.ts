import { openDatabase, put, requestToPromise, STORE_NAMES } from "../storage/database";
import type { ContributionEdge } from "./edge";

const MIN_DELAY_MS = 60 * 60 * 1000;
const MAX_DELAY_MS = 6 * 60 * 60 * 1000;

interface QueuedContribution {
  id: number;
  edge: ContributionEdge;
  // PRIVACY.md section 5: "held for a randomised interval between 1 and 6
  // hours". Assigned once, when the edge is queued, not recomputed on
  // every alarm tick: the interval is about how long any one edge sits
  // before it can go out, not a retry backoff.
  readyAt: number;
}

// PRIVACY.md's own reasoning for the random hold: sending the moment a
// review is read would let an adversary who also watches network timing
// correlate a submission with the page load that produced it. random()
// defaults to Math.random, overridable so a test does not have to wait
// out a real hour to see this queue produce something.
export async function enqueueContributionEdges(
  edges: readonly ContributionEdge[],
  now: () => number = Date.now,
  random: () => number = Math.random,
): Promise<void> {
  if (edges.length === 0) {
    return;
  }
  const db = await openDatabase();
  const store = db
    .transaction(STORE_NAMES.graphContributionQueue, "readwrite")
    .objectStore(STORE_NAMES.graphContributionQueue);
  for (const edge of edges) {
    const readyAt = now() + MIN_DELAY_MS + random() * (MAX_DELAY_MS - MIN_DELAY_MS);
    await put(store, { edge, readyAt } as Omit<QueuedContribution, "id">);
  }
}

// every queued edge whose randomised hold has elapsed, oldest first: a
// batch submitted in queue order rather than in whatever order IndexedDB
// happens to return matches leaks nothing extra, since the server never
// learns queue order carries meaning either way, but it keeps behaviour
// deterministic for tests.
export async function listDueContributions(now: number): Promise<QueuedContribution[]> {
  const db = await openDatabase();
  const store = db
    .transaction(STORE_NAMES.graphContributionQueue, "readonly")
    .objectStore(STORE_NAMES.graphContributionQueue);
  const all = await requestToPromise<QueuedContribution[]>(store.getAll());
  return all.filter((item) => item.readyAt <= now).sort((a, b) => a.readyAt - b.readyAt);
}

export async function deleteContributions(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const db = await openDatabase();
  const store = db
    .transaction(STORE_NAMES.graphContributionQueue, "readwrite")
    .objectStore(STORE_NAMES.graphContributionQueue);
  for (const id of ids) {
    await requestToPromise(store.delete(id));
  }
}

export async function countQueuedContributions(): Promise<number> {
  const db = await openDatabase();
  const store = db
    .transaction(STORE_NAMES.graphContributionQueue, "readonly")
    .objectStore(STORE_NAMES.graphContributionQueue);
  return requestToPromise<number>(store.count());
}
