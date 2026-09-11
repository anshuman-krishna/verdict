import { describe, expect, it } from "vitest";
import {
  BUCKET_COUNT,
  buildLookupBatches,
  MAX_REAL_PREFIXES_PER_REQUEST,
  MAX_REQUESTS,
  matchFlaggedReviewers,
  PREFIX_LENGTH,
  reviewerHash,
  reviewerPrefixes,
} from "./lookup";

function sequentialRandom(): () => number {
  let n = 0;
  return () => {
    n = (n + 0.137) % 1;
    return n;
  };
}

function reviewerIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `reviewer-${i}`);
}

describe("reviewerHash", () => {
  it("matches the well known sha256('hello') vector with an empty salt", async () => {
    expect(await reviewerHash("hello", "")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("changes with the salt, so the same reviewer id hashes differently per purpose", async () => {
    const a = await reviewerHash("reviewer-1", "salt-a");
    const b = await reviewerHash("reviewer-1", "salt-b");
    expect(a).not.toBe(b);
  });
});

describe("buildLookupBatches", () => {
  it("gives every request exactly BUCKET_COUNT distinct hex prefixes", async () => {
    const batches = await buildLookupBatches(reviewerIds(50), "salt", sequentialRandom());
    for (const batch of batches) {
      expect(batch.prefixes).toHaveLength(BUCKET_COUNT);
      expect(new Set(batch.prefixes).size).toBe(BUCKET_COUNT);
      for (const prefix of batch.prefixes) {
        expect(prefix).toMatch(new RegExp(`^[0-9a-f]{${PREFIX_LENGTH}}$`));
      }
    }
  });

  it("includes the real prefix for every reviewer id when they fit in one request", async () => {
    const ids = ["alice", "bob"];
    const batches = await buildLookupBatches(ids, "salt", sequentialRandom());
    expect(batches).toHaveLength(1);
    for (const id of ids) {
      const hash = await reviewerHash(id, "salt");
      expect(batches[0]?.prefixes).toContain(hash.slice(0, PREFIX_LENGTH));
    }
  });

  it("never lets a request carry more real prefixes than the cap, which is what the padding is for", async () => {
    const salt = "salt";
    const ids = reviewerIds(200);
    const real = new Set(await reviewerPrefixes(ids, salt));
    const batches = await buildLookupBatches(ids, salt, sequentialRandom());

    for (const batch of batches) {
      const realInBatch = batch.prefixes.filter((prefix) => real.has(prefix));
      expect(realInBatch.length).toBeLessThanOrEqual(MAX_REAL_PREFIXES_PER_REQUEST);
      expect(realInBatch.length).toBeLessThan(batch.prefixes.length / 2);
    }
  });

  it("bounds how many requests a single page can produce", async () => {
    const batches = await buildLookupBatches(reviewerIds(5000), "salt", sequentialRandom());
    expect(batches.length).toBeLessThanOrEqual(MAX_REQUESTS);
  });

  it("does not send the real prefixes in sorted order, which would leak which they are", async () => {
    const salt = "salt";
    const ids = reviewerIds(120);
    const real = new Set(await reviewerPrefixes(ids, salt));
    const batches = await buildLookupBatches(ids, salt, sequentialRandom());
    const covered = batches.flatMap((batch) => batch.prefixes.filter((p) => real.has(p)));
    const sorted = [...covered].sort();

    expect(covered).not.toEqual(sorted);
  });

  it("tolerates the same reviewer id appearing twice without erroring", async () => {
    const batches = await buildLookupBatches(["alice", "alice"], "salt", sequentialRandom());
    const hash = await reviewerHash("alice", "salt");
    expect(batches).toHaveLength(1);
    expect(batches[0]?.prefixes).toContain(hash.slice(0, PREFIX_LENGTH));
    expect(batches[0]?.prefixes).toHaveLength(BUCKET_COUNT);
  });

  it("still returns one padded request with no reviewer ids at all", async () => {
    const batches = await buildLookupBatches([], "salt", sequentialRandom());
    expect(batches).toHaveLength(1);
    expect(batches[0]?.prefixes).toHaveLength(BUCKET_COUNT);
  });

  it("draws decoys from crypto by default rather than a modellable prng", async () => {
    const first = await buildLookupBatches([], "salt");
    const second = await buildLookupBatches([], "salt");
    expect(first[0]?.prefixes).not.toEqual(second[0]?.prefixes);
  });
});

describe("matchFlaggedReviewers", () => {
  it("flags a reviewer id whose full hash appears in a response", async () => {
    const salt = "salt";
    const flaggedHash = await reviewerHash("flagged-user", salt);
    const responses = [{ matches: { [flaggedHash.slice(0, PREFIX_LENGTH)]: [flaggedHash] } }];

    const flagged = await matchFlaggedReviewers(["flagged-user", "clean-user"], salt, responses);

    expect(flagged.has("flagged-user")).toBe(true);
    expect(flagged.has("clean-user")).toBe(false);
  });

  it("merges matches across the batches a single page produced", async () => {
    const salt = "salt";
    const first = await reviewerHash("a", salt);
    const second = await reviewerHash("b", salt);
    const responses = [
      { matches: { [first.slice(0, PREFIX_LENGTH)]: [first] } },
      { matches: { [second.slice(0, PREFIX_LENGTH)]: [second] } },
    ];

    const flagged = await matchFlaggedReviewers(["a", "b", "c"], salt, responses);

    expect([...flagged].sort()).toEqual(["a", "b"]);
  });

  it("does not flag a reviewer merely sharing a prefix with a flagged hash", async () => {
    const salt = "salt";
    const cleanHash = await reviewerHash("clean-user", salt);
    const responses = [
      { matches: { [cleanHash.slice(0, PREFIX_LENGTH)]: ["not-actually-this-users-hash"] } },
    ];

    const flagged = await matchFlaggedReviewers(["clean-user"], salt, responses);

    expect(flagged.size).toBe(0);
  });

  it("treats an absent prefix key the same as an empty bucket", async () => {
    const flagged = await matchFlaggedReviewers(["someone"], "salt", [{ matches: {} }]);
    expect(flagged.size).toBe(0);
  });
});
