import { getPref, setPref } from "../storage/prefs";
import type { RulesDocument } from "./rules";

// SPEC.md section 9: "rules are fetched at most once a day, cached,
// signed, and version pinned. a signature failure falls back to the
// bundled copy and never blocks analysis." the signing scheme (ecdsa,
// p-256, over a canonical json encoding of the rules document) is not
// specified there, it is claude's choice of build infrastructure, made for
// broad, long standing support in both chrome's and firefox's webcrypto.

export interface SignedRulesEnvelope {
  rules: RulesDocument;
  // base64, over canonicalJson(rules), ecdsa p-256 with sha-256
  signature: string;
}

interface RulesCacheRecord {
  rules: RulesDocument;
  fetchedAt: number;
}

export interface RulesLoaderOptions {
  url: string;
  publicKeyJwk: JsonWebKey;
  bundledDefault: RulesDocument;
  cacheKey: string;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// a stable encoding independent of key insertion order, so a signature
// verifies the same way regardless of how the document happened to be
// constructed. arrays keep their order, since order is meaningful there.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

// the .slice() copies into a plain ArrayBuffer, since some typescript lib
// versions type Uint8Array.from's backing buffer as ArrayBufferLike, which
// webcrypto's BufferSource does not accept
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).slice();
}

async function verifySignature(
  rules: RulesDocument,
  signatureBase64: string,
  publicKeyJwk: JsonWebKey,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const data = new TextEncoder().encode(canonicalJson(rules));
    const signature = base64ToBytes(signatureBase64);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, data);
  } catch {
    return false;
  }
}

// never throws. any failure, network, a bad response, a signature that
// does not verify, or a fetched version older than one already trusted,
// falls back to the bundled default rather than blocking analysis.
export async function loadRules(options: RulesLoaderOptions): Promise<RulesDocument> {
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  const cached = await getPref<RulesCacheRecord>(options.cacheKey);
  if (cached !== null && now() - cached.fetchedAt < cacheTtlMs) {
    return cached.rules;
  }

  try {
    const response = await fetchImpl(options.url);
    if (!response.ok) {
      return options.bundledDefault;
    }
    const envelope = (await response.json()) as SignedRulesEnvelope;
    const verified = await verifySignature(envelope.rules, envelope.signature, options.publicKeyJwk);
    if (!verified) {
      return options.bundledDefault;
    }

    // version pinned: never accept a document older than whatever this
    // extension already trusts, whether that is a previous fetch or the
    // bundled default, so a compromised or stale mirror cannot roll back
    // a fix that a newer rules version made.
    const trustedVersion = cached?.rules.version ?? options.bundledDefault.version;
    if (envelope.rules.version < trustedVersion) {
      return options.bundledDefault;
    }

    await setPref(options.cacheKey, { rules: envelope.rules, fetchedAt: now() });
    return envelope.rules;
  } catch {
    return options.bundledDefault;
  }
}
