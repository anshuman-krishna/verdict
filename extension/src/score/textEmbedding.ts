import { fnv1a64 } from "./textNearDuplication";

// SPEC.md 5.4 asks for a quantised sentence embedding model in wasm. that model does not exist in
// this repository and section 16 open question 2 is still open on whether 0.1 pays its bundle cost,
// so this is the bundled default: a signed hashing projection over word unigrams and bigrams,
// deterministic in both languages and costing no megabytes. it is lexical, not semantic, and
// listingDrift.ts's wording is what that supports.

export const EMBEDDING_DIMENSIONS = 256;

const MASK_64 = (1n << 64n) - 1n;
const SIGN_BIT = 63n;

// unicode letter or number, matching python's str.isalnum. anything else separates tokens, so
// punctuation, whitespace, and emoji do not become vocabulary
const ALPHANUMERIC = /[\p{L}\p{N}]/u;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const character of text.toLowerCase()) {
    if (ALPHANUMERIC.test(character)) {
      current += character;
      continue;
    }
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

// bigrams as well as unigrams: "phone case" and "case phone" are different products, and a bag of
// single words cannot tell them apart
export function terms(tokens: readonly string[]): string[] {
  const result = [...tokens];
  for (let i = 0; i + 1 < tokens.length; i++) {
    result.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return result;
}

// a review fills well under half its buckets, so this is what reviewsCache.ts persists: the same
// numbers as the dense vector at a fraction of the bytes, and integers, so a cache hit normalises
// to bit identical floats. flat pairs of bucket and signed count, ascending by bucket.
export type TermCounts = number[];

export function hashTerms(text: string, dimensions = EMBEDDING_DIMENSIONS): TermCounts {
  const counts = new Map<number, number>();
  for (const term of terms(tokenize(text))) {
    const hash = fnv1a64(term) & MASK_64;
    const bucket = Number(hash % BigInt(dimensions));
    const sign = (hash >> SIGN_BIT) & 1n ? -1 : 1;
    counts.set(bucket, (counts.get(bucket) ?? 0) + sign);
  }
  const flat: TermCounts = [];
  for (const bucket of [...counts.keys()].sort((a, b) => a - b)) {
    flat.push(bucket, counts.get(bucket) as number);
  }
  return flat;
}

// null when nothing hashed, or when every term cancelled against a collision of the opposite sign,
// so a caller never divides by a zero norm
export function embedTermCounts(
  counts: TermCounts,
  dimensions = EMBEDDING_DIMENSIONS,
): number[] | null {
  const vector = new Array<number>(dimensions).fill(0);
  for (let i = 0; i + 1 < counts.length; i += 2) {
    const bucket = counts[i] as number;
    if (bucket < 0 || bucket >= dimensions) {
      return null;
    }
    vector[bucket] = counts[i + 1] as number;
  }
  return normalizeVector(vector);
}

export function embedText(text: string, dimensions = EMBEDDING_DIMENSIONS): number[] | null {
  return embedTermCounts(hashTerms(text, dimensions), dimensions);
}

// both arguments are unit vectors from embedText, so this is a plain dot product
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    total += (a[i] as number) * (b[i] as number);
  }
  return total;
}

export function normalizeVector(vector: readonly number[]): number[] | null {
  let sumOfSquares = 0;
  for (const value of vector) {
    sumOfSquares += value * value;
  }
  if (sumOfSquares === 0) {
    return null;
  }
  const norm = Math.sqrt(sumOfSquares);
  return vector.map((value) => value / norm);
}
