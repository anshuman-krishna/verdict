import { fetchWithin } from "../net/fetchWithin";
import { buildLookupRequest, matchFlaggedReviewers, type LookupResponse } from "./lookup";


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
  const random = options.random ?? Math.random;
  const delay = options.delay ?? defaultDelay;
  try {
    const request = await buildLookupRequest(reviewerIds, options.salt, random);
    await delay(MIN_DELAY_MS + random() * (MAX_DELAY_MS - MIN_DELAY_MS));
    const response = await fetchWithin(
      fetchImpl,
      options.endpoint,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      },
      options.timeoutMs,
    );
    if (response === null || !response.ok) {
      return new Set();
    }
    const body = (await response.json()) as LookupResponse;
    return await matchFlaggedReviewers(reviewerIds, options.salt, body);
  } catch {
    return new Set();
  }
}
