import { getGraphContributionEnabled } from "../storage/settings";
import { fetchWithin } from "../net/fetchWithin";
import type { ContributionEdge } from "./edge";
import { holdUntil } from "../net/retryAfter";
import {
  clearContributionQueue,
  deferContributions,
  deleteContributions,
  listDueContributions,
} from "./queue";

// tests/contract/serviceLimits.json, the service refuses anything larger
export const MAX_EDGES_PER_BATCH = 500;
export const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;

// statuses that say try later, not never
const RETRYABLE_CLIENT_STATUSES = new Set([408, 425, 429]);

export interface FlushDeps {
  endpoint: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  isEnabled?: () => Promise<boolean>;
  clearQueue?: () => Promise<void>;
  hold?: (until: number) => Promise<unknown>;
}

export interface FlushResult {
  submitted: number;
  dropped?: number;
  // when the service asked to be left alone, rather than the caller having to guess
  heldUntil?: number;
}

interface Queued {
  id: number;
  edge: ContributionEdge;
}

const encoder = new TextEncoder();

function bodyFor(items: readonly Queued[]): string {
  return JSON.stringify({ edges: items.map((item) => item.edge) });
}

export function chunkForService(
  items: readonly Queued[],
  maxEdges: number = MAX_EDGES_PER_BATCH,
  maxBytes: number = MAX_REQUEST_BODY_BYTES,
): { chunks: Queued[][]; unsendable: Queued[] } {
  const chunks: Queued[][] = [];
  const unsendable: Queued[] = [];
  const envelopeBytes = encoder.encode('{"edges":[]}').length;
  let current: Queued[] = [];
  let currentBytes = envelopeBytes;

  for (const item of items) {
    const edgeBytes = encoder.encode(JSON.stringify(item.edge)).length;
    if (envelopeBytes + edgeBytes > maxBytes) {
      unsendable.push(item);
      continue;
    }
    const separator = current.length > 0 ? 1 : 0;
    if (current.length >= maxEdges || currentBytes + separator + edgeBytes > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = envelopeBytes;
    }
    currentBytes += (current.length > 0 ? 1 : 0) + edgeBytes;
    current.push(item);
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return { chunks, unsendable };
}

function isPermanentRefusal(status: number | undefined): boolean {
  return (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    !RETRYABLE_CLIENT_STATUSES.has(status)
  );
}

export async function flushDueContributions(deps: FlushDeps): Promise<FlushResult> {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const isEnabled = deps.isEnabled ?? getGraphContributionEnabled;

  // the switch is checked at send time, not only at queue time
  if (!(await isEnabled())) {
    await (deps.clearQueue ?? clearContributionQueue)();
    return { submitted: 0 };
  }

  const due = await listDueContributions(now());
  if (due.length === 0) {
    return { submitted: 0 };
  }

  const { chunks, unsendable } = chunkForService(due);
  let dropped = unsendable.length;
  if (unsendable.length > 0) {
    await deleteContributions(unsendable.map((item) => item.id));
  }

  let submitted = 0;
  let heldUntil: number | undefined;
  const hold = deps.hold ?? deferContributions;
  for (const chunk of chunks) {
    const ids = chunk.map((item) => item.id);
    let response: Response | null;
    try {
      response = await fetchWithin(
        fetchImpl,
        deps.endpoint,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: bodyFor(chunk),
        },
        deps.timeoutMs,
      );
    } catch {
      break;
    }
    if (response === null) {
      break;
    }
    if (response.ok) {
      await deleteContributions(ids);
      submitted += chunk.length;
      continue;
    }
    // only this chunk is refused, the rest of the queue is not
    if (isPermanentRefusal(response.status)) {
      await deleteContributions(ids);
      dropped += chunk.length;
      continue;
    }
    heldUntil = holdUntil(response.headers.get("retry-after"), now());
    await hold(heldUntil);
    break;
  }

  const result: FlushResult = { submitted };
  if (dropped > 0) {
    result.dropped = dropped;
  }
  if (heldUntil !== undefined) {
    result.heldUntil = heldUntil;
  }
  return result;
}
