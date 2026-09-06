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
  try {
    const request = await buildLookupRequest(reviewerIds, options.salt, options.random);
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
