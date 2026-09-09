import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, loadRules, type SignedRulesEnvelope } from "./rulesLoader";
import type { RulesDocument } from "./rules";

const FIELDS = { title: { strategy: "selector", value: "h1" } } as const;

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
  return { version: 1, site: "example", locales: ["com"], fields: FIELDS };
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
    const rules: RulesDocument = { version: 2, site: "example", locales: ["com"], fields: FIELDS };
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
    const rules: RulesDocument = { version: 2, site: "example", locales: ["com"], fields: FIELDS };
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

    now += 60_000;
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
    const signedRules: RulesDocument = { version: 2, site: "example", locales: ["com"], fields: FIELDS };
    const signature = await sign(signedRules, keyPair.privateKey);
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

  it("falls back to the bundled default rather than hanging when the fetch never resolves", async () => {
    const keyPair = await generateKeypair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const fallback = bundledDefault();
    const fetchImpl: typeof fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );

    const result = await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: fallback,
      cacheKey: freshCacheKey(),
      fetchImpl,
      fetchTimeoutMs: 10,
    });

    expect(result).toEqual(fallback);
  });

  it("rejects a version rollback even with a valid signature", async () => {
    const keyPair = await generateKeypair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const cacheKey = freshCacheKey();
    let now = 1_000_000;

    const newerRules: RulesDocument = { version: 5, site: "example", locales: ["com"], fields: FIELDS };
    const newerEnvelope: SignedRulesEnvelope = {
      rules: newerRules,
      signature: await sign(newerRules, keyPair.privateKey),
    };

    await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: bundledDefault(),
      cacheKey,
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, json: async () => newerEnvelope }),
      now: () => now,
    });
    now += 25 * 60 * 60 * 1000; // past the 24 hour ttl

    const olderRules: RulesDocument = { version: 3, site: "example", locales: ["com"], fields: FIELDS };
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

describe("loadRules against a signed but malformed document", () => {
  async function envelopeFor(rules: unknown): Promise<{
    envelope: SignedRulesEnvelope;
    publicKeyJwk: JsonWebKey;
  }> {
    const keyPair = await generateKeypair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const signature = await sign(rules as RulesDocument, keyPair.privateKey);
    return { envelope: { rules: rules as RulesDocument, signature }, publicKeyJwk };
  }

  it("falls back to the bundled rules rather than trusting the shape", async () => {
    const { envelope, publicKeyJwk } = await envelopeFor({
      version: 9,
      site: "example",
      locales: ["com"],
      fields: "not an object",
    });
    const bundled = bundledDefault();

    const result = await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: bundled,
      cacheKey: freshCacheKey(),
      fetchImpl: async () => ({ ok: true, json: async () => envelope }) as unknown as Response,
    });
    expect(result).toBe(bundled);
  });

  it("refuses a document that would extract nothing", async () => {
    const { envelope, publicKeyJwk } = await envelopeFor({
      version: 9,
      site: "example",
      locales: ["com"],
      fields: {},
    });
    const bundled = bundledDefault();

    const result = await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: bundled,
      cacheKey: freshCacheKey(),
      fetchImpl: async () => ({ ok: true, json: async () => envelope }) as unknown as Response,
    });
    expect(result).toBe(bundled);
  });

  it("caches nothing when the document is refused, so it is retried", async () => {
    const { envelope, publicKeyJwk } = await envelopeFor({
      version: 9,
      site: "example",
      locales: ["com"],
      fields: {},
    });
    const fetchImpl = vi.fn(
      async () => ({ ok: true, json: async () => envelope }) as unknown as Response,
    );
    const cacheKey = freshCacheKey();
    const options = {
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: bundledDefault(),
      cacheKey,
      fetchImpl,
    };

    await loadRules(options);
    await loadRules(options);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps a document whose unusable field is only one of several", async () => {
    const { envelope, publicKeyJwk } = await envelopeFor({
      version: 9,
      site: "example",
      locales: ["com"],
      fields: {
        title: { strategy: "selector", value: "h1" },
        reviews: { strategy: "unheard-of" },
      },
    });

    const result = await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: bundledDefault(),
      cacheKey: freshCacheKey(),
      fetchImpl: async () => ({ ok: true, json: async () => envelope }) as unknown as Response,
    });
    expect(Object.keys(result.fields)).toEqual(["title"]);
  });
});

describe("loadRules reporting what it had to drop", () => {
  async function envelopeFor(rules: unknown): Promise<{
    envelope: SignedRulesEnvelope;
    publicKeyJwk: JsonWebKey;
  }> {
    const keyPair = await generateKeypair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    return {
      envelope: { rules: rules as RulesDocument, signature: await sign(rules as RulesDocument, keyPair.privateKey) },
      publicKeyJwk,
    };
  }

  it("names each field it discarded", async () => {
    const { envelope, publicKeyJwk } = await envelopeFor({
      version: 9,
      site: "example",
      locales: ["com"],
      fields: { title: { strategy: "selector", value: "h1" }, reviews: { strategy: "unheard-of" } },
    });
    const problems: string[][] = [];

    await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: bundledDefault(),
      cacheKey: freshCacheKey(),
      fetchImpl: async () => ({ ok: true, json: async () => envelope }) as unknown as Response,
      onProblems: (lines) => problems.push([...lines]),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.[0]).toMatch(/reviews/);
  });

  it("says so when the whole document is refused", async () => {
    const { envelope, publicKeyJwk } = await envelopeFor({
      version: 9,
      site: "example",
      locales: ["com"],
      fields: {},
    });
    const problems: string[][] = [];

    await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: bundledDefault(),
      cacheKey: freshCacheKey(),
      fetchImpl: async () => ({ ok: true, json: async () => envelope }) as unknown as Response,
      onProblems: (lines) => problems.push([...lines]),
    });
    expect(problems[0]?.[0]).toMatch(/not a rules document/);
  });

  it("says nothing when every field was usable", async () => {
    const { envelope, publicKeyJwk } = await envelopeFor({
      version: 9,
      site: "example",
      locales: ["com"],
      fields: { title: { strategy: "selector", value: "h1" } },
    });
    const problems: string[][] = [];

    await loadRules({
      url: "https://verdict.tools/rules.json",
      publicKeyJwk,
      bundledDefault: bundledDefault(),
      cacheKey: freshCacheKey(),
      fetchImpl: async () => ({ ok: true, json: async () => envelope }) as unknown as Response,
      onProblems: (lines) => problems.push([...lines]),
    });
    expect(problems).toEqual([]);
  });
});
