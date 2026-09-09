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

export async function loadRules(options: RulesLoaderOptions): Promise<RulesDocument> {
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  const cached = await getPref<RulesCacheRecord>(options.cacheKey);
  if (cached !== null && now() - cached.fetchedAt < cacheTtlMs) {
    return cached.rules;
  }

  try {
    const response = await fetchImpl(options.url, { signal: AbortSignal.timeout(fetchTimeoutMs) });
    if (!response.ok) {
      return options.bundledDefault;
    }
    const envelope = (await response.json()) as SignedRulesEnvelope;
    const verified = await verifySignature(envelope.rules, envelope.signature, options.publicKeyJwk);
    if (!verified) {
      return options.bundledDefault;
    }

    const sanitised = sanitiseRulesDocument(envelope.rules);
    if (sanitised === null) {
      reportProblems(options, ["the fetched document is not a rules document this build can use"]);
      return options.bundledDefault;
    }
    if (sanitised.problems.length > 0) {
      reportProblems(options, sanitised.problems);
    }

    const trustedVersion = cached?.rules.version ?? options.bundledDefault.version;
    if (sanitised.rules.version < trustedVersion) {
      return options.bundledDefault;
    }

    await setPref(options.cacheKey, { rules: sanitised.rules, fetchedAt: now() });
    return sanitised.rules;
  } catch {
    return options.bundledDefault;
  }
}
