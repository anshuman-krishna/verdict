// SPEC.md section 8, the k anonymous reputation lookup protocol. only
// relevant from version 0.2 (the reviewer graph, SPEC.md 5.6), built now
// because the protocol is fully specified and does not wait on the
// fixture corpus, ground truth, or any reserved decision, unlike the
// service that would answer it.

export const PREFIX_LENGTH = 4;
export const BUCKET_COUNT = 32;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// h = sha256(reviewer_id + salt), computed locally. the server never
// sees a reviewer id or this full hash, only its first PREFIX_LENGTH
// characters, mixed in with random padding.
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

// fisher-yates, so a padded prefix's position in the request never
// signals whether it was real: an observer who saw the array in
// insertion order (real prefixes first, then padding) would learn
// exactly what the padding exists to hide.
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

// real prefixes, deduplicated, padded with random prefixes up to a fixed
// count of BUCKET_COUNT, then shuffled. if dedup still leaves more than
// BUCKET_COUNT distinct real prefixes, an unusually large and diverse
// reviewer set, only the first BUCKET_COUNT (by hash order, not review
// order) are asked about: the request never grows past its fixed size,
// since a bigger request would itself stand out.
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

// which of the caller's reviewer ids the response flags, checked
// entirely locally. the server only ever saw prefixes; it never learns
// which of the reviewer ids in this call actually mattered, or how many
// of them there were.
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
