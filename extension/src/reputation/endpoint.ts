// a build constant pointing at the deployed k anonymous lookup service
// from SPEC.md section 8, the same pattern wxt.config.ts already uses for
// the production site domain. Not a secret and not a privacy boundary:
// the protocol's guarantee comes from the request only ever carrying
// BUCKET_COUNT hash prefixes, never from this url being hidden. Swap it
// for the real deployed host if it ever differs from verdict.tools.
export const DEFAULT_REPUTATION_ENDPOINT = "https://api.verdict.tools/v1/reputation/lookup";
