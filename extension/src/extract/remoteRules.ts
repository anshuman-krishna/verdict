const RULES_BASE = "https://verdict.tools/rules";

// the id becomes a path segment, so it may only ever be one
const SAFE_SITE_ID = /^[a-z0-9-]+$/;

export function isSafeSiteId(siteId: string): boolean {
  return SAFE_SITE_ID.test(siteId);
}

export function remoteRulesUrl(siteId: string): string {
  if (!isSafeSiteId(siteId)) {
    throw new Error(`not a site id: ${siteId}`);
  }
  return `${RULES_BASE}/${siteId}.json`;
}

export function remoteRulesCacheKey(siteId: string): string {
  if (!isSafeSiteId(siteId)) {
    throw new Error(`not a site id: ${siteId}`);
  }
  return `remoteRules:${siteId}`;
}

// one signing key covers every site, so a new storefront needs no key ceremony
// placeholder key, nothing can sign
export const REMOTE_RULES_PUBLIC_KEY_JWK: JsonWebKey = {
  kty: "EC",
  crv: "P-256",
  x: "vmDL-YVSMASGJKoPDmaGBE_Kn-Q2I2cuFJQffvFTiss",
  y: "tPKTrg6779ExvNC0V01uZl8JDh1TiCz4jZxdElpr80k",
};
