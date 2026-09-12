import { fetchWithin } from "../net/fetchWithin";
import { BUNDLED_RULES, emptyRules } from "./bundledRules";
import { REMOTE_RULES_PUBLIC_KEY_JWK, remoteRulesCacheKey, remoteRulesUrl } from "./remoteRules";
import { SITES } from "./sites";
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

export type RulesSet = Readonly<Record<string, RulesDocument>>;

export interface SiteRulesOptions {
  bundled?: Readonly<Record<string, RulesDocument>>;
  publicKeyJwk?: JsonWebKey;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  fetchTimeoutMs?: number;
  onProblems?: (problems: readonly string[]) => void;
}

export function optionsForSite(siteId: string, options: SiteRulesOptions = {}): RulesLoaderOptions {
  const bundled = options.bundled ?? BUNDLED_RULES;
  return {
    url: remoteRulesUrl(siteId),
    cacheKey: remoteRulesCacheKey(siteId),
    publicKeyJwk: options.publicKeyJwk ?? REMOTE_RULES_PUBLIC_KEY_JWK,
    bundledDefault: bundled[siteId] ?? emptyRules(siteId),
    cacheTtlMs: options.cacheTtlMs,
    fetchImpl: options.fetchImpl,
    now: options.now,
    fetchTimeoutMs: options.fetchTimeoutMs,
    onProblems: options.onProblems,
  };
}

export function trustedRulesForSite(
  siteId: string,
  options: SiteRulesOptions = {},
): Promise<RulesDocument> {
  return trustedRules(optionsForSite(siteId, options));
}

async function forEverySite(
  siteIds: readonly string[],
  load: (siteId: string) => Promise<RulesDocument>,
): Promise<RulesSet> {
  const loaded = await Promise.all(
    // one site failing must not take the others with it
    siteIds.map(async (siteId) => {
      try {
        return [siteId, await load(siteId)] as const;
      } catch {
        return [siteId, emptyRules(siteId)] as const;
      }
    }),
  );
  return Object.fromEntries(loaded);
}

export function trustedRulesForEverySite(
  siteIds: readonly string[] = SITES.map((site) => site.id),
  options: SiteRulesOptions = {},
): Promise<RulesSet> {
  return forEverySite(siteIds, (siteId) => trustedRulesForSite(siteId, options));
}

// every site refreshes on the same alarm, each against its own ttl
export function loadRulesForEverySite(
  siteIds: readonly string[] = SITES.map((site) => site.id),
  options: SiteRulesOptions = {},
): Promise<RulesSet> {
  return forEverySite(siteIds, (siteId) => loadRules(optionsForSite(siteId, options)));
}
