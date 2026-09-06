#!/usr/bin/env node
// Deployment tooling for SPEC.md section 9's signed remote rules, the
// other half of extract/rulesLoader.ts's verifySignature. Nothing in
// this repository runs this automatically: PLAN.md week 7 calls the real
// remote rules infrastructure a deployment decision, which starts with a
// real keypair whose private half lives in a secrets store, never in
// this repository. This script is what someone runs by hand, once that
// keypair exists, to turn a rules.json into the envelope
// extract/remoteRules.ts's REMOTE_RULES_URL is expected to serve.
//
// Usage:
//   node scripts/sign-rules.mjs --rules path/to/rules.json --key path/to/private-key.jwk.json --out path/to/amazon.json
//
// --key must be a JSON Web Key for a P-256 ECDSA private key (the same
// curve rulesLoader.ts verifies against), for example one generated with:
//   node -e "
//     const { webcrypto } = require('crypto');
//     webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
//       .then(async (pair) => {
//         console.log('PRIVATE (keep this secret):', JSON.stringify(await webcrypto.subtle.exportKey('jwk', pair.privateKey)));
//         console.log('PUBLIC (goes in extract/remoteRules.ts):', JSON.stringify(await webcrypto.subtle.exportKey('jwk', pair.publicKey)));
//       });
//   "
// Never commit the private key. The public half is what
// REMOTE_RULES_PUBLIC_KEY_JWK in extract/remoteRules.ts needs updating to.

import { webcrypto } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key === undefined || value === undefined) {
      throw new Error("usage: sign-rules.mjs --rules <path> --key <path> --out <path>");
    }
    args[key] = value;
  }
  for (const required of ["rules", "key", "out"]) {
    if (args[required] === undefined) {
      throw new Error(`missing required --${required}`);
    }
  }
  return args;
}

// mirrors extract/rulesLoader.ts's canonicalJson exactly: a signature
// produced any other way will not verify against what the extension
// computes when it checks one.
function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const rules = JSON.parse(readFileSync(args.rules, "utf8"));
  const privateKeyJwk = JSON.parse(readFileSync(args.key, "utf8"));

  const privateKey = await webcrypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const data = new TextEncoder().encode(canonicalJson(rules));
  const signatureBytes = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, data);

  const envelope = { rules, signature: bytesToBase64(new Uint8Array(signatureBytes)) };
  writeFileSync(args.out, JSON.stringify(envelope, null, 2));
  console.log(`wrote signed envelope for rules version ${rules.version} to ${args.out}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
