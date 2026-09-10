import coefficients from "../../../schema/minhash-coefficients.json";

// mersenne prime, so a*h stays exact
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
  signatureCache?: WeakMap<ReviewForNearDuplication, bigint[]>;
  linkCache?: DuplicateLinkCache;
}

export interface DuplicateLinks {
  population: object;
  bands: number;
  rows: number;
  threshold: number;
  linked: (readonly bigint[])[];
}

export type DuplicateLinkCache = WeakMap<readonly bigint[], DuplicateLinks>;

export function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_BASIS;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash;
}

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

const bandKeyCache = new WeakMap<readonly bigint[], { bands: number; rows: number; keys: string[] }>();

function bandKeys(signature: readonly bigint[], bands: number, rows: number): string[] {
  const cached = bandKeyCache.get(signature);
  if (cached !== undefined && cached.bands === bands && cached.rows === rows) {
    return cached.keys;
  }
  const parts = signature.map((value) => value.toString());
  const keys: string[] = [];
  for (let band = 0; band < bands; band++) {
    const start = band * rows;
    keys.push(`${band}:${parts.slice(start, start + rows).join(",")}`);
  }
  bandKeyCache.set(signature, { bands, rows, keys });
  return keys;
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

export function textNearDuplication(
  reviews: readonly ReviewForNearDuplication[],
  options: TextNearDuplicationOptions = {},
): TextNearDuplicationResult {
  const shingleSize = options.shingleSize ?? DEFAULT_SHINGLE_SIZE;
  const numPermutations = options.numPermutations ?? DEFAULT_NUM_PERMUTATIONS;
  const bands = options.bands ?? DEFAULT_BANDS;
  const rows = options.rows ?? DEFAULT_ROWS;
  const threshold = options.jaccardThreshold ?? DEFAULT_JACCARD_THRESHOLD;

  const seeded = (review: ReviewForNearDuplication): bigint[] | undefined => {
    const cached = options.signatureCache?.get(review);
    return cached !== undefined && cached.length === numPermutations ? cached : undefined;
  };

  const byText = new Map<string, bigint[]>();
  const signatures: (readonly bigint[])[] = [];
  for (const review of reviews) {
    const cached = seeded(review);
    if (cached !== undefined) {
      signatures.push(cached);
      continue;
    }
    if (review.text === null || review.text.length === 0) {
      continue;
    }
    const shared = byText.get(review.text);
    const signature = shared ??
      minhashSignature(shingle(review.text, shingleSize), numPermutations);
    if (shared === undefined) {
      byText.set(review.text, signature);
    }
    options.signatureCache?.set(review, signature);
    signatures.push(signature);
  }
  if (signatures.length < 2) {
    return {
      duplicateReviewShare: signatures.length === 0 ? null : 0,
      clusterCount: 0,
      largestClusterShare: 0,
    };
  }

  const unionFind = new UnionFind(signatures.length);

  const firstIndexOf = new Map<readonly bigint[], number>();
  const distinct: number[] = [];
  for (let i = 0; i < signatures.length; i++) {
    const signature = signatures[i] as readonly bigint[];
    const first = firstIndexOf.get(signature);
    if (first === undefined) {
      firstIndexOf.set(signature, i);
      distinct.push(i);
    } else {
      unionFind.union(i, first);
    }
  }

  const links = options.linkCache ?? new WeakMap<readonly bigint[], DuplicateLinks>();
  if (!linksCover(links, signatures, distinct, bands, rows, threshold)) {
    findLinks(links, signatures, distinct, bands, rows, threshold);
  }

  for (const i of distinct) {
    const entry = links.get(signatures[i] as readonly bigint[]) as DuplicateLinks;
    for (const other of entry.linked) {
      const j = firstIndexOf.get(other);
      if (j !== undefined) {
        unionFind.union(i, j);
      }
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
    duplicateReviewShare: duplicateReviewCount / signatures.length,
    clusterCount,
    largestClusterShare: largestClusterSize / signatures.length,
  };
}

function linksCover(
  links: DuplicateLinkCache,
  signatures: readonly (readonly bigint[])[],
  distinct: readonly number[],
  bands: number,
  rows: number,
  threshold: number,
): boolean {
  const first = links.get(signatures[distinct[0] as number] as readonly bigint[]);
  if (
    first === undefined || first.bands !== bands || first.rows !== rows ||
    first.threshold !== threshold
  ) {
    return false;
  }
  return distinct.every((i) =>
    links.get(signatures[i] as readonly bigint[])?.population === first.population
  );
}

function findLinks(
  links: DuplicateLinkCache,
  signatures: readonly (readonly bigint[])[],
  distinct: readonly number[],
  bands: number,
  rows: number,
  threshold: number,
): void {
  const buckets = new Map<string, number[]>();
  for (const i of distinct) {
    for (const key of bandKeys(signatures[i] as readonly bigint[], bands, rows)) {
      const bucket = buckets.get(key);
      if (bucket === undefined) {
        buckets.set(key, [i]);
      } else {
        bucket.push(i);
      }
    }
  }

  const width = signatures.length;
  const candidatePairs = new Set<number>();
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) {
      continue;
    }
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        candidatePairs.add((bucket[i] as number) * width + (bucket[j] as number));
      }
    }
  }

  const linked = new Map<number, (readonly bigint[])[]>();
  for (const i of distinct) {
    linked.set(i, []);
  }
  for (const pair of candidatePairs) {
    const left = Math.floor(pair / width);
    const right = pair % width;
    const similarity = estimateJaccard(
      signatures[left] as readonly bigint[],
      signatures[right] as readonly bigint[],
    );
    if (similarity > threshold) {
      linked.get(left)?.push(signatures[right] as readonly bigint[]);
      linked.get(right)?.push(signatures[left] as readonly bigint[]);
    }
  }

  const population = {};
  for (const i of distinct) {
    links.set(signatures[i] as readonly bigint[], {
      population,
      bands,
      rows,
      threshold,
      linked: linked.get(i) as (readonly bigint[])[],
    });
  }
}
