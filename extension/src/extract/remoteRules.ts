// the site is the cdn: a plain file under site/public, so no server logic and nothing to log
export const REMOTE_RULES_URL = "https://verdict.tools/rules/amazon.json";

// a placeholder whose private half was never written down, so nothing can sign against it. every
// fetch therefore 404s or fails verification, and loadRules falls back to the bundled rules
export const REMOTE_RULES_PUBLIC_KEY_JWK: JsonWebKey = {
  kty: "EC",
  crv: "P-256",
  x: "vmDL-YVSMASGJKoPDmaGBE_Kn-Q2I2cuFJQffvFTiss",
  y: "tPKTrg6779ExvNC0V01uZl8JDh1TiCz4jZxdElpr80k",
};

export const REMOTE_RULES_CACHE_KEY = "remoteRules:amazon";
