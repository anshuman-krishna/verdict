import { openDatabase, put, requestToPromise, STORE_NAMES } from "../storage/database";
import type { ContributionEdge } from "./edge";

const MIN_DELAY_MS = 60 * 60 * 1000;
const MAX_DELAY_MS = 6 * 60 * 60 * 1000;

interface QueuedContribution {
  id: number;
  edge: ContributionEdge;
  readyAt: number;
}

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

export async function clearContributionQueue(): Promise<void> {
  const db = await openDatabase();
  const store = db
    .transaction(STORE_NAMES.graphContributionQueue, "readwrite")
    .objectStore(STORE_NAMES.graphContributionQueue);
  await requestToPromise(store.clear());
}
