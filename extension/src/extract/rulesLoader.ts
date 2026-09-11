import { fetchWithin } from "../net/fetchWithin";
import { getPref, setPref } from "../storage/prefs";
import { canonicalJson } from "./canonicalJson";
import type { RulesDocument } from "./rules";
import { sanitiseRulesDocument } from "./validateRules";

export { canonicalJson };


export interface SignedRulesEnvelope {
  rules: RulesDocument;
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
  onProblems?: (problems: readonly string[]) => void;
  cacheKey: string;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  fetchTimeoutMs?: number;
}

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;

function isFresh(fetchedAt: number, now: number, ttlMs: number): boolean {
  // a clock that moved backwards must not freeze a document in place
  return now - fetchedAt < ttlMs && fetchedAt <= now;
}

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

function reportProblems(options: RulesLoaderOptions, problems: readonly string[]): void {
  const report = options.onProblems ?? ((lines) => console.warn("verdict rules:", ...lines));
  report(problems);
}

async function cachedRecord(cacheKey: string): Promise<RulesCacheRecord | null> {
  const cached = await getPref<RulesCacheRecord>(cacheKey);
  if (cached === null) {
    return null;
  }
  // revalidated on the way out, not only on the way in
  const sanitised = sanitiseRulesDocument(cached.rules);
  return sanitised === null ? null : { rules: sanitised.rules, fetchedAt: cached.fetchedAt };
}

// what this install already trusts, with no network on the path
export async function trustedRules(options: RulesLoaderOptions): Promise<RulesDocument> {
  const cached = await cachedRecord(options.cacheKey);
  if (cached === null) {
    return options.bundledDefault;
  }
  // a newer document stays in use even when the refresh cannot happen
  return cached.rules.version >= options.bundledDefault.version
    ? cached.rules
    : options.bundledDefault;
}

export async function refreshRules(options: RulesLoaderOptions): Promise<RulesDocument> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  const cached = await cachedRecord(options.cacheKey);
  const trusted = await trustedRules(options);

  try {
    const response = await fetchWithin(fetchImpl, options.url, {}, fetchTimeoutMs);
    if (response === null || !response.ok) {
      return trusted;
    }
    const envelope = (await response.json()) as SignedRulesEnvelope;
    const verified = await verifySignature(envelope.rules, envelope.signature, options.publicKeyJwk);
    if (!verified) {
      return trusted;
    }

    const sanitised = sanitiseRulesDocument(envelope.rules);
    if (sanitised === null) {
      reportProblems(options, ["the fetched document is not a rules document this build can use"]);
      return trusted;
    }
    if (sanitised.problems.length > 0) {
      reportProblems(options, sanitised.problems);
    }

    // a replayed older release must not demote anyone
    if (sanitised.rules.version < Math.max(cached?.rules.version ?? 0, options.bundledDefault.version)) {
      return trusted;
    }

    await setPref(options.cacheKey, { rules: sanitised.rules, fetchedAt: now() });
    return sanitised.rules;
  } catch {
    return trusted;
  }
}

export async function loadRules(options: RulesLoaderOptions): Promise<RulesDocument> {
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = options.now ?? Date.now;

  const cached = await cachedRecord(options.cacheKey);
  if (cached !== null && isFresh(cached.fetchedAt, now(), cacheTtlMs)) {
    return await trustedRules(options);
  }
  return await refreshRules(options);
}
