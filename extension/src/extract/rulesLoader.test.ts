import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, loadRules, type SignedRulesEnvelope } from "./rulesLoader";
import type { RulesDocument } from "./rules";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function generateKeypair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
}

async function sign(rules: RulesDocument, privateKey: CryptoKey): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson(rules));
  const signatureBytes = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    data,
  );
  return bytesToBase64(new Uint8Array(signatureBytes));
}

function bundledDefault(): RulesDocument {
  return { version: 1, site: "example", locales: ["com"], fields: {} };
}

let cacheKeyCounter = 0;
function freshCacheKey(): string {
  cacheKeyCounter += 1;
  return `rulesLoader.test.${cacheKeyCounter}`;
}

describe("canonicalJson", () => {
  it("hand computed: sorts keys regardless of insertion order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("hand computed: sorts nested object keys, but keeps array order", () => {
    expect(canonicalJson({ z: [{ b: 1, a: 2 }], a: 1 })).toBe('{"a":1,"z":[{"a":2,"b":1}]}');
  });
});

describe("loadRules", () => {
  it("returns the fetched rules when the signature verifies", async () => {
    const keyPair = await generateKeypair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const rules: RulesDocument = { version: 2, site: "example", locales: ["com"], fields: {} };
    const envelope: SignedRulesEnvelope = { rules, signature: await sign(rules, keyPair.privateKey) };

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => envelope,
    });

    const result = await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: bundledDefault(),
      cacheKey: freshCacheKey(),
      fetchImpl,
    });

    expect(result).toEqual(rules);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("caches a verified fetch and does not fetch again within the ttl", async () => {
    const keyPair = await generateKeypair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const rules: RulesDocument = { version: 2, site: "example", locales: ["com"], fields: {} };
    const envelope: SignedRulesEnvelope = { rules, signature: await sign(rules, keyPair.privateKey) };
    const cacheKey = freshCacheKey();

    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => envelope });
    let now = 1_000_000;

    const first = await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: bundledDefault(),
      cacheKey,
      fetchImpl,
      now: () => now,
    });
    expect(first).toEqual(rules);

    now += 60_000; // an hour later, well inside the 24 hour ttl
    const second = await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: bundledDefault(),
      cacheKey,
      fetchImpl,
      now: () => now,
    });

    expect(second).toEqual(rules);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("falls back to the bundled default when the signature does not verify", async () => {
    const keyPair = await generateKeypair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const signedRules: RulesDocument = { version: 2, site: "example", locales: ["com"], fields: {} };
    const signature = await sign(signedRules, keyPair.privateKey);
    // tampered after signing: the version claimed in the envelope no longer
    // matches what was actually signed
    const tamperedRules: RulesDocument = { ...signedRules, version: 99 };
    const envelope: SignedRulesEnvelope = { rules: tamperedRules, signature };

    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => envelope });
    const fallback = bundledDefault();

    const result = await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: fallback,
      cacheKey: freshCacheKey(),
      fetchImpl,
    });

    expect(result).toEqual(fallback);
  });

  it("falls back to the bundled default when the response is not ok", async () => {
    const keyPair = await generateKeypair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const fallback = bundledDefault();

    const result = await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: fallback,
      cacheKey: freshCacheKey(),
      fetchImpl,
    });

    expect(result).toEqual(fallback);
  });

  it("falls back to the bundled default when the fetch throws", async () => {
    const keyPair = await generateKeypair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const fallback = bundledDefault();

    const result = await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: fallback,
      cacheKey: freshCacheKey(),
      fetchImpl,
    });

    expect(result).toEqual(fallback);
  });

  it("rejects a version rollback even with a valid signature", async () => {
    const keyPair = await generateKeypair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const cacheKey = freshCacheKey();
    let now = 1_000_000;

    const newerRules: RulesDocument = { version: 5, site: "example", locales: ["com"], fields: {} };
    const newerEnvelope: SignedRulesEnvelope = {
      rules: newerRules,
      signature: await sign(newerRules, keyPair.privateKey),
    };

    // first call establishes version 5 as trusted, then the ttl expires
    await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: bundledDefault(),
      cacheKey,
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, json: async () => newerEnvelope }),
      now: () => now,
    });
    now += 25 * 60 * 60 * 1000; // past the 24 hour ttl

    const olderRules: RulesDocument = { version: 3, site: "example", locales: ["com"], fields: {} };
    const olderEnvelope: SignedRulesEnvelope = {
      rules: olderRules,
      signature: await sign(olderRules, keyPair.privateKey),
    };
    const fallback = bundledDefault();

    const result = await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: fallback,
      cacheKey,
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, json: async () => olderEnvelope }),
      now: () => now,
    });

    expect(result).toEqual(fallback);
  });
});
