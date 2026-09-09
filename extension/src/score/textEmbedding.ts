import { fnv1a64 } from "./textNearDuplication";


export const EMBEDDING_DIMENSIONS = 256;

const MASK_64 = (1n << 64n) - 1n;
const SIGN_BIT = 63n;

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

export function terms(tokens: readonly string[]): string[] {
  const result = [...tokens];
  for (let i = 0; i + 1 < tokens.length; i++) {
    result.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return result;
}

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
