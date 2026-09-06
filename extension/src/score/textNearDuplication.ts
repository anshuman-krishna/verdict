import coefficients from "../../../schema/minhash-coefficients.json";

// a mersenne prime, large enough that fnv1a64 hashes reduce into it with
// negligible bias, small enough that a*h stays inside a 64 bit range times a
// 61 bit range, which bigint handles exactly either way
const MODULUS = (1n << 61n) - 1n;

const FNV_OFFSET_BASIS = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const MASK_64 = (1n << 64n) - 1n;

export const DEFAULT_SHINGLE_SIZE = 5;
export const DEFAULT_NUM_PERMUTATIONS = 128;
export const DEFAULT_BANDS = 32;
export const DEFAULT_ROWS = 4;
export const DEFAULT_JACCARD_THRESHOLD = 0.7;

export interface ReviewForNearDuplication {
  text: string | null;
}

export interface TextNearDuplicationResult {
  duplicateReviewShare: number | null;
  clusterCount: number;
  largestClusterShare: number;
}

export interface TextNearDuplicationOptions {
  shingleSize?: number;
  numPermutations?: number;
  bands?: number;
  rows?: number;
  jaccardThreshold?: number;
  // performance only, never changes the result: a review's minhash
  // signature depends only on its own text, not on which other reviews
  // are in this call, so it is safe to compute once per review object
  // and reuse across repeated calls that share it by reference.
  // buildReport.ts's bootstrap resamples with replacement from the same
  // source array (bootstrap.ts's resample()), so the same review object
  // commonly reappears across many of its 200 resamples; measured,
  // recomputing every signature from scratch on every resample is what
  // makes buildReport.ts take seconds instead of milliseconds. Omitted,
  // behaviour is identical to before this option existed. Caller's
  // responsibility: a single cache instance must only ever be shared
  // across calls that use the same shingleSize and numPermutations, since
  // a cached signature does not know which parameters produced it.
  signatureCache?: WeakMap<ReviewForNearDuplication, bigint[]>;
}

// fnv-1a, 64 bit, over the utf-8 bytes of the string
export function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_BASIS;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash;
}

// character n-grams over lowercased, whitespace collapsed text. text shorter
// than the shingle size becomes its own single shingle rather than producing
// no shingles at all.
export function shingle(text: string, shingleSize: number): Set<string> {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, " ");
  if (normalized.length <= shingleSize) {
    return new Set([normalized]);
  }
  const shingles = new Set<string>();
  for (let i = 0; i <= normalized.length - shingleSize; i++) {
    shingles.add(normalized.slice(i, i + shingleSize));
  }
  return shingles;
}

// exact jaccard similarity of two shingle sets, independent of minhash. used
// to sanity check the minhash estimate in tests, never at runtime.
export function exactJaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) {
      intersection++;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function minhashSignature(
  shingles: ReadonlySet<string>,
  numPermutations: number,
): bigint[] {
  const hashes = Array.from(shingles, (value) => fnv1a64(value) % MODULUS);
  const signature: bigint[] = [];
  for (let i = 0; i < numPermutations; i++) {
    const pair = coefficients[i] as [string, string] | undefined;
    if (pair === undefined) {
      throw new Error(`numPermutations exceeds the ${coefficients.length} shared coefficients`);
    }
    // coefficients are stored as decimal strings because they exceed
    // Number.MAX_SAFE_INTEGER and a plain json import would round them
    const a = BigInt(pair[0]);
    const b = BigInt(pair[1]);
    let min: bigint | null = null;
    for (const h of hashes) {
      const value = (a * h + b) % MODULUS;
      if (min === null || value < min) {
        min = value;
      }
    }
    signature.push(min ?? 0n);
  }
  return signature;
}

export function estimateJaccard(signatureA: readonly bigint[], signatureB: readonly bigint[]): number {
  let matches = 0;
  for (let i = 0; i < signatureA.length; i++) {
    if (signatureA[i] === signatureB[i]) {
      matches++;
    }
  }
  return matches / signatureA.length;
}

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) {
      root = this.parent[root] as number;
    }
    let cur = x;
    while (this.parent[cur] !== root) {
      const next = this.parent[cur] as number;
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }

  union(x: number, y: number): void {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX !== rootY) {
      this.parent[rootX] = rootY;
    }
  }
}

// SPEC.md 5.4: minhash with 128 permutations over character 5 grams, banded
// lsh, cluster reviews above 0.7 jaccard similarity. bands and rows and the
// output shape are not specified there; this is a proposal, not a ratified
// spec line.
export function textNearDuplication(
  reviews: readonly ReviewForNearDuplication[],
  options: TextNearDuplicationOptions = {},
): TextNearDuplicationResult {
  const shingleSize = options.shingleSize ?? DEFAULT_SHINGLE_SIZE;
  const numPermutations = options.numPermutations ?? DEFAULT_NUM_PERMUTATIONS;
  const bands = options.bands ?? DEFAULT_BANDS;
  const rows = options.rows ?? DEFAULT_ROWS;
  const threshold = options.jaccardThreshold ?? DEFAULT_JACCARD_THRESHOLD;

  const eligible = reviews.filter(
    (review): review is { text: string } => review.text !== null && review.text.length > 0,
  );
  if (eligible.length < 2) {
    return { duplicateReviewShare: eligible.length === 0 ? null : 0, clusterCount: 0, largestClusterShare: 0 };
  }

  const signatures = eligible.map((review) => {
    const cached = options.signatureCache?.get(review);
    if (cached !== undefined) {
      return cached;
    }
    const signature = minhashSignature(shingle(review.text, shingleSize), numPermutations);
    options.signatureCache?.set(review, signature);
    return signature;
  });

  const buckets = new Map<string, number[]>();
  for (let band = 0; band < bands; band++) {
    const start = band * rows;
    for (let i = 0; i < signatures.length; i++) {
      const signature = signatures[i] as bigint[];
      const key = `${band}:${signature.slice(start, start + rows).join(",")}`;
      const bucket = buckets.get(key);
      if (bucket === undefined) {
        buckets.set(key, [i]);
      } else {
        bucket.push(i);
      }
    }
  }

  const unionFind = new UnionFind(signatures.length);
  const candidatePairs = new Set<string>();
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) {
      continue;
    }
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        candidatePairs.add(`${bucket[i]}:${bucket[j]}`);
      }
    }
  }

  for (const pair of candidatePairs) {
    const [left, right] = pair.split(":").map(Number) as [number, number];
    const similarity = estimateJaccard(
      signatures[left] as bigint[],
      signatures[right] as bigint[],
    );
    if (similarity > threshold) {
      unionFind.union(left, right);
    }
  }

  const clusterSizes = new Map<number, number>();
  for (let i = 0; i < signatures.length; i++) {
    const root = unionFind.find(i);
    clusterSizes.set(root, (clusterSizes.get(root) ?? 0) + 1);
  }

  let duplicateReviewCount = 0;
  let clusterCount = 0;
  let largestClusterSize = 0;
  for (const size of clusterSizes.values()) {
    if (size >= 2) {
      duplicateReviewCount += size;
      clusterCount++;
      largestClusterSize = Math.max(largestClusterSize, size);
    }
  }

  return {
    duplicateReviewShare: duplicateReviewCount / eligible.length,
    clusterCount,
    largestClusterShare: largestClusterSize / eligible.length,
  };
}
