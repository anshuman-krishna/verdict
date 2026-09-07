// the encoding a rules signature is computed over, on both sides of it:
// rulesLoader.ts when it verifies one, and scripts/sign-rules.mjs when it
// produces one. This was written twice, once here and once in the signing
// script, with a comment on each saying it mirrored the other. A drift
// between them would not fail a test or raise an error: every published
// document would simply stop verifying, every extension would fall back to
// its bundled rules, and the remote fix path would be dead with nothing
// saying so. One copy removes that.
//
// A stable encoding independent of key insertion order, so a signature
// verifies the same way regardless of how the document happened to be
// constructed. Arrays keep their order, since order is meaningful there.
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
