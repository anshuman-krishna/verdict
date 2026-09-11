import { ANONYMOUS_REQUEST_INIT, fetchWithin } from "../net/fetchWithin";
import {
  buildLookupBatches,
  cryptoRandom,
  matchFlaggedReviewers,
  type LookupResponse,
} from "./lookup";

export { ANONYMOUS_REQUEST_INIT };

export interface LookupOptions {
  endpoint: string;
  salt: string;
  fetchImpl?: typeof fetch;
  random?: () => number;
  delay?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const MIN_DELAY_MS = 200;
const MAX_DELAY_MS = 4000;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function lookupFlaggedReviewers(
  reviewerIds: readonly string[],
  options: LookupOptions,
): Promise<Set<string>> {
  if (reviewerIds.length === 0) {
    return new Set();
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const random = options.random ?? cryptoRandom;
  const delay = options.delay ?? defaultDelay;
  try {
    const batches = await buildLookupBatches(reviewerIds, options.salt, random);
    const responses: LookupResponse[] = [];
    for (const batch of batches) {
      // independent per batch, so the requests do not arrive as a recognisable burst
      await delay(MIN_DELAY_MS + random() * (MAX_DELAY_MS - MIN_DELAY_MS));
      const response = await fetchWithin(
        fetchImpl,
        options.endpoint,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batch),
        },
        options.timeoutMs,
      );
      if (response === null || !response.ok) {
        continue;
      }
      responses.push((await response.json()) as LookupResponse);
    }
    if (responses.length === 0) {
      return new Set();
    }
    return await matchFlaggedReviewers(reviewerIds, options.salt, responses);
  } catch {
    return new Set();
  }
}
