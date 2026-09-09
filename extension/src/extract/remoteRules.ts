export const REMOTE_RULES_URL = "https://verdict.tools/rules/amazon.json";

// placeholder key, nothing can sign
export const REMOTE_RULES_PUBLIC_KEY_JWK: JsonWebKey = {
  kty: "EC",
  crv: "P-256",
  x: "vmDL-YVSMASGJKoPDmaGBE_Kn-Q2I2cuFJQffvFTiss",
  y: "tPKTrg6779ExvNC0V01uZl8JDh1TiCz4jZxdElpr80k",
};

export const REMOTE_RULES_CACHE_KEY = "remoteRules:amazon";
