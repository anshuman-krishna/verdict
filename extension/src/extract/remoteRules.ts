// SPEC.md section 9: "rules are fetched at most once a day, cached,
// signed, and version pinned." rulesLoader.ts implements the mechanism;
// this file is the two build constants amazon.content.ts needs to
// actually call it, following the same pattern reputation/endpoint.ts
// already set for a not yet deployed production URL.

// PRIVACY.md section 3: "a static signed file on a CDN, carries no
// parameters, no cookie, and no identifier, and is identical for every
// user." The site itself is that CDN: an Astro static build can serve
// this path as a plain file the same way it serves any other asset under
// site/public, with no server logic and nothing to log.
export const REMOTE_RULES_URL = "https://verdict.tools/rules/amazon.json";

// Generated once for this repository (P-256, the same curve
// rulesLoader.ts's signature check already hard codes) with
// `crypto.subtle.generateKey`, export the public half as JWK, and
// deliberately never write the private half to disk anywhere: this key
// cannot sign anything, on purpose. Real production signing needs a real
// keypair whose private half lives in a secrets store, not in a
// repository, and swapping that in is a deployment decision (PLAN.md
// week 7), not a code change. Until that exists, every fetch to
// REMOTE_RULES_URL either 404s (nothing is deployed there yet) or, if
// something were ever served there, fails signature verification against
// this placeholder key: loadRules's own contract makes both of those
// resolve to bundledRules.ts's BUNDLED_AMAZON_RULES, exactly like today.
export const REMOTE_RULES_PUBLIC_KEY_JWK: JsonWebKey = {
  kty: "EC",
  crv: "P-256",
  x: "vmDL-YVSMASGJKoPDmaGBE_Kn-Q2I2cuFJQffvFTiss",
  y: "tPKTrg6779ExvNC0V01uZl8JDh1TiCz4jZxdElpr80k",
};

export const REMOTE_RULES_CACHE_KEY = "remoteRules:amazon";
