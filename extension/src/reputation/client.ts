import { buildLookupRequest, matchFlaggedReviewers, type LookupResponse } from "./lookup";

// SPEC.md section 4: the reviewer graph service is "opt in, off by
// default". Everything in this file only ever runs when a caller
// explicitly chooses to invoke it (gated in contentScript/orchestrator.ts
// by storage/settings.ts's reputationLookupEnabled, itself defaulting to
// false), never as part of the default analysis path tests/no-network.spec.ts
// guards.

export interface LookupOptions {
  endpoint: string;
  salt: string;
  fetchImpl?: typeof fetch;
  random?: () => number;
  delay?: (ms: number) => Promise<void>;
}

// PRIVACY.md section 4's "known limit, stated rather than hidden": decoy
// padding alone still lets an adversary who controls both the network and
// the storefront correlate a lookup firing with a page load by its
// timing. PRIVACY.md commits to mitigating that with "random request
// delay", which is a real property /privacy claims, not an aspiration, so
// it has to actually run here rather than living only in the docs. The
// bounds are a build infrastructure choice, not a ratified
// number: long enough to blur the correlation against typical page load
// jitter, short enough that a report still feels like it arrived
// promptly.
const MIN_DELAY_MS = 200;
const MAX_DELAY_MS = 4000;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// never throws: SPEC.md section 13's pattern throughout is that the
// service being unreachable degrades to "local signals only, no user
// visible message", not an error state, so a network failure here
// resolves to an empty set exactly as if the lookup found nothing flagged.
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
    const response = await fetchImpl(options.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      return new Set();
    }
    const body = (await response.json()) as LookupResponse;
    return await matchFlaggedReviewers(reviewerIds, options.salt, body);
  } catch {
    return new Set();
  }
}
