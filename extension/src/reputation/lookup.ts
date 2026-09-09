export const PREFIX_LENGTH = 4;
export const BUCKET_COUNT = 32;

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

export interface LookupRequest {
  prefixes: string[];
}

export async function buildLookupRequest(
  reviewerIds: readonly string[],
  salt: string,
  random: () => number = Math.random,
): Promise<LookupRequest> {
  const hashes = await Promise.all(reviewerIds.map((id) => reviewerHash(id, salt)));
  const realPrefixes = [...new Set(hashes.map((hash) => hash.slice(0, PREFIX_LENGTH)))]
    .sort()
    .slice(0, BUCKET_COUNT);

  const prefixes = new Set(realPrefixes);
  while (prefixes.size < BUCKET_COUNT) {
    prefixes.add(randomHexPrefix(random));
  }

  return { prefixes: shuffle([...prefixes], random) };
}

export interface LookupResponse {
  matches: Record<string, string[]>;
}

export async function matchFlaggedReviewers(
  reviewerIds: readonly string[],
  salt: string,
  response: LookupResponse,
): Promise<Set<string>> {
  const flagged = new Set<string>();
  for (const reviewerId of reviewerIds) {
    const hash = await reviewerHash(reviewerId, salt);
    const prefix = hash.slice(0, PREFIX_LENGTH);
    const bucket = response.matches[prefix];
    if (bucket !== undefined && bucket.includes(hash)) {
      flagged.add(reviewerId);
    }
  }
  return flagged;
}
