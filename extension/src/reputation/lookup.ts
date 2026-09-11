export const PREFIX_LENGTH = 4;
export const BUCKET_COUNT = 32;

// SPEC.md section 8 pads to 32, so a request must never be all real prefixes
export const MAX_REAL_PREFIXES_PER_REQUEST = 8;
export const MAX_REQUESTS = 8;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function reviewerHash(reviewerId: string, salt: string): Promise<string> {
  return sha256Hex(`${reviewerId}${salt}`);
}

// decoys a modelled prng could pick out are not decoys
export function cryptoRandom(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] as number) / 2 ** 32;
}

function randomHexPrefix(random: () => number): string {
  let result = "";
  for (let i = 0; i < PREFIX_LENGTH; i++) {
    result += Math.floor(random() * 16).toString(16);
  }
  return result;
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i] as T;
    const b = result[j] as T;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

function padToBucketCount(real: readonly string[], random: () => number): string[] {
  const prefixes = new Set(real);
  // a decoy colliding with a real prefix would otherwise loop forever
  for (let attempt = 0; prefixes.size < BUCKET_COUNT && attempt < BUCKET_COUNT * 64; attempt++) {
    prefixes.add(randomHexPrefix(random));
  }
  return shuffle([...prefixes], random);
}

export interface LookupRequest {
  prefixes: string[];
}

export async function reviewerPrefixes(
  reviewerIds: readonly string[],
  salt: string,
): Promise<string[]> {
  const hashes = await Promise.all(reviewerIds.map((id) => reviewerHash(id, salt)));
  return [...new Set(hashes.map((hash) => hash.slice(0, PREFIX_LENGTH)))];
}

// one request per slice of real prefixes, each padded to 32
export async function buildLookupBatches(
  reviewerIds: readonly string[],
  salt: string,
  random: () => number = cryptoRandom,
): Promise<LookupRequest[]> {
  const real = shuffle(await reviewerPrefixes(reviewerIds, salt), random)
    .slice(0, MAX_REAL_PREFIXES_PER_REQUEST * MAX_REQUESTS);
  if (real.length === 0) {
    return [{ prefixes: padToBucketCount([], random) }];
  }

  const batches: LookupRequest[] = [];
  for (let start = 0; start < real.length; start += MAX_REAL_PREFIXES_PER_REQUEST) {
    const slice = real.slice(start, start + MAX_REAL_PREFIXES_PER_REQUEST);
    batches.push({ prefixes: padToBucketCount(slice, random) });
  }
  return batches;
}

export interface LookupResponse {
  matches: Record<string, string[]>;
}

export async function matchFlaggedReviewers(
  reviewerIds: readonly string[],
  salt: string,
  responses: readonly LookupResponse[],
): Promise<Set<string>> {
  const flaggedHashes = new Set<string>();
  for (const response of responses) {
    for (const bucket of Object.values(response.matches ?? {})) {
      if (!Array.isArray(bucket)) {
        continue;
      }
      for (const hash of bucket) {
        flaggedHashes.add(hash);
      }
    }
  }

  const flagged = new Set<string>();
  for (const reviewerId of reviewerIds) {
    if (flaggedHashes.has(await reviewerHash(reviewerId, salt))) {
      flagged.add(reviewerId);
    }
  }
  return flagged;
}
