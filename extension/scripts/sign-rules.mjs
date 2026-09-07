#!/usr/bin/env node
// Deployment tooling for SPEC.md section 9's signed remote rules, the other
// half of extract/rulesLoader.ts's verifySignature. Nothing in this
// repository runs this automatically: PLAN.md week 7 calls the real remote
// rules infrastructure a deployment decision, which starts with a real
// keypair whose private half lives in a secrets store, never here. This is
// what someone runs by hand, once that keypair exists.
//
// Usage:
//   just sign-rules --key path/to/private-key.jwk.json
//   node scripts/sign-rules.mjs --key <path> [--rules <path>] [--out <path>]
//
// --rules defaults to the document the extension bundles, so signing
// publishes exactly what the next build would ship, and --out defaults to
// the path the site serves it from (extract/remoteRules.ts's
// REMOTE_RULES_URL).
//
// --key must be a JSON Web Key for a P-256 ECDSA private key, the same
// curve rulesLoader.ts verifies against. To make a keypair:
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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildEnvelope, canonicalJson, publishProblems } from "./signRules.mjs";

const HERE = import.meta.dirname;
const DEFAULT_RULES = resolve(HERE, "..", "src", "extract", "rules", "amazon.json");
const DEFAULT_OUT = resolve(HERE, "..", "..", "site", "public", "rules", "amazon.json");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key === undefined || value === undefined) {
      throw new Error("usage: sign-rules.mjs --key <path> [--rules <path>] [--out <path>]");
    }
    args[key] = value;
  }
  if (args.key === undefined) {
    throw new Error("missing required --key");
  }
  return args;
}

// null on a first publish, when nothing is served yet.
function publishedVersion(outPath) {
  try {
    return JSON.parse(readFileSync(outPath, "utf8")).rules.version ?? null;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rulesPath = args.rules ?? DEFAULT_RULES;
  const outPath = args.out ?? DEFAULT_OUT;

  const document = JSON.parse(readFileSync(rulesPath, "utf8"));
  const problems = publishProblems(document, publishedVersion(outPath));
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`refusing to sign: ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  const privateKey = await webcrypto.subtle.importKey(
    "jwk",
    JSON.parse(readFileSync(args.key, "utf8")),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(canonicalJson(document));
  const signatureBytes = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    data,
  );

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    `${JSON.stringify(buildEnvelope(document, bytesToBase64(new Uint8Array(signatureBytes))), null, 2)}\n`,
  );
  console.log(`wrote signed envelope for rules version ${document.version} to ${outPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
