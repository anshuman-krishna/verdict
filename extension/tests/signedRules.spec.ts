// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BUNDLED_AMAZON_RULES } from "../src/extract/bundledRules";
import { loadRules, type SignedRulesEnvelope } from "../src/extract/rulesLoader";

// the whole SPEC.md section 9 path, end to end: a document signed by the real scripts/sign-
// rules.mjs and verified by the extension that has to trust it. The two halves share one canonical
// encoding and one validator, and this is what proves they agree rather than merely intending to.
//
// the keypair is generated here and thrown away with the temp directory. A private key in a
// repository is a private key that has leaked, so there is no committed fixture for this and there
// should not be.

const SCRIPT = resolve(import.meta.dirname, "..", "scripts", "sign-rules.mjs");

const RULES = {
  version: 3,
  site: "amazon",
  locales: ["com", "fr", "de", "co.uk"],
  fields: {
    title: { strategy: "selector", value: "#productTitle" },
    reviews: {
      strategy: "embedded-json",
      path: "$.reviewsData.reviews[*]",
      fallback: {
        strategy: "composite",
        container: "[data-hook='review']",
        fields: {
          text: { strategy: "selector", value: "[data-hook='review-body']" },
          verified: { strategy: "presence", value: "[data-hook='avp-badge']" },
        },
      },
    },
  },
};

let envelope: SignedRulesEnvelope;
let publicKeyJwk: JsonWebKey;

function sign(rules: unknown, directory: string): SignedRulesEnvelope {
  const rulesPath = join(directory, "rules.json");
  const outPath = join(directory, "amazon.json");
  writeFileSync(rulesPath, JSON.stringify(rules));
  execFileSync("node", [SCRIPT, "--key", join(directory, "key.json"), "--rules", rulesPath, "--out", outPath]);
  return JSON.parse(readFileSync(outPath, "utf8")) as SignedRulesEnvelope;
}

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const directory = mkdtempSync(join(tmpdir(), "verdict-signing-"));
  writeFileSync(
    join(directory, "key.json"),
    JSON.stringify(await crypto.subtle.exportKey("jwk", keyPair.privateKey)),
  );
  envelope = sign(RULES, directory);
});

function load(cacheKey: string, response: unknown, key: JsonWebKey = publicKeyJwk) {
  return loadRules({
    url: "https://verdict.tools/rules/amazon.json",
    publicKeyJwk: key,
    bundledDefault: BUNDLED_AMAZON_RULES,
    cacheKey,
    fetchImpl: async () => ({ ok: true, json: async () => response }) as unknown as Response,
  });
}

describe("a document signed by the publishing script", () => {
  it("verifies against the extension's own loader", async () => {
    const loaded = await load("signed-accepted", envelope);
    expect(loaded.version).toBe(3);
    expect(Object.keys(loaded.fields).sort()).toEqual(["reviews", "title"]);
  });

  it("carries the composite fallback through intact", async () => {
    const loaded = await load("signed-composite", envelope);
    const reviews = loaded.fields.reviews;
    expect(reviews?.strategy).toBe("embedded-json");
    expect(reviews?.fallback?.strategy).toBe("composite");
  });

  // the signature covers the document exactly as sent, so one edited
  // character anywhere in it has to fail.
  it("stops verifying when one character of the document changes", async () => {
    const tampered = JSON.parse(JSON.stringify(envelope)) as SignedRulesEnvelope;
    (tampered.rules.fields.title as { value: string }).value = "#productTitl";
    expect(await load("signed-tampered", tampered)).toBe(BUNDLED_AMAZON_RULES);
  });

  it("stops verifying under a key that did not sign it", async () => {
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const otherJwk = await crypto.subtle.exportKey("jwk", other.publicKey);
    expect(await load("signed-wrong-key", envelope, otherJwk)).toBe(BUNDLED_AMAZON_RULES);
  });
});

describe("what the publishing script refuses to sign", () => {
  function refusal(rules: unknown): string {
    const directory = mkdtempSync(join(tmpdir(), "verdict-signing-"));
    writeFileSync(join(directory, "key.json"), JSON.stringify({ kty: "EC" }));
    try {
      sign(rules, directory);
      return "";
    } catch (error) {
      return String((error as { stderr?: Buffer }).stderr ?? error);
    }
  }

  it("refuses a document with no fields, which would extract nothing", () => {
    expect(refusal({ ...RULES, fields: {} })).toMatch(/refusing to sign/);
  });

  // the loader drops an unusable field so the rest of a document still delivers its fixes. A
  // publisher signing one would be shipping a fix that silently does not apply.
  it("refuses a field the extension would discard on arrival", () => {
    const rules = { ...RULES, fields: { ...RULES.fields, extra: { strategy: "from-the-future" } } };
    expect(refusal(rules)).toMatch(/would discard extra/);
  });

  it("refuses something that is not a rules document", () => {
    expect(refusal({ version: "three" })).toMatch(/not a rules document/);
  });
});
