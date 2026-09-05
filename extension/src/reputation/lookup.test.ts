import { describe, expect, it } from "vitest";
import {
  BUCKET_COUNT,
  buildLookupRequest,
  matchFlaggedReviewers,
  PREFIX_LENGTH,
  reviewerHash,
} from "./lookup";

// deterministic in the sense that it never repeats and every call is a
// different value, which is all buildLookupRequest's dedup/shuffle logic
// needs to be exercised meaningfully, unlike a fixed constant.
function sequentialRandom(): () => number {
  let n = 0;
  return () => {
    n = (n + 0.137) % 1;
    return n;
  };
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

describe("buildLookupRequest", () => {
  it("always returns exactly BUCKET_COUNT distinct hex prefixes", async () => {
    const request = await buildLookupRequest(["a", "b", "c"], "salt", sequentialRandom());
    expect(request.prefixes).toHaveLength(BUCKET_COUNT);
    expect(new Set(request.prefixes).size).toBe(BUCKET_COUNT);
    for (const prefix of request.prefixes) {
      expect(prefix).toMatch(new RegExp(`^[0-9a-f]{${PREFIX_LENGTH}}$`));
    }
  });

  it("includes the real prefix for every reviewer id supplied", async () => {
    const reviewerIds = ["alice", "bob"];
    const salt = "salt";
    const request = await buildLookupRequest(reviewerIds, salt, sequentialRandom());
    for (const reviewerId of reviewerIds) {
      const hash = await reviewerHash(reviewerId, salt);
      expect(request.prefixes).toContain(hash.slice(0, PREFIX_LENGTH));
    }
  });

  it("tolerates the same reviewer id appearing twice without erroring", async () => {
    const request = await buildLookupRequest(["alice", "alice"], "salt", sequentialRandom());
    const hash = await reviewerHash("alice", "salt");
    expect(request.prefixes).toContain(hash.slice(0, PREFIX_LENGTH));
    expect(request.prefixes).toHaveLength(BUCKET_COUNT);
  });

  it("still returns exactly BUCKET_COUNT prefixes with no reviewer ids at all", async () => {
    const request = await buildLookupRequest([], "salt", sequentialRandom());
    expect(request.prefixes).toHaveLength(BUCKET_COUNT);
  });
});

describe("matchFlaggedReviewers", () => {
  it("flags a reviewer id whose full hash appears under its own prefix", async () => {
    const salt = "salt";
    const flaggedHash = await reviewerHash("flagged-user", salt);
    const response = { matches: { [flaggedHash.slice(0, PREFIX_LENGTH)]: [flaggedHash] } };

    const flagged = await matchFlaggedReviewers(["flagged-user", "clean-user"], salt, response);

    expect(flagged.has("flagged-user")).toBe(true);
    expect(flagged.has("clean-user")).toBe(false);
  });

  it("does not flag a reviewer merely sharing a prefix with a flagged hash", async () => {
    const salt = "salt";
    const cleanHash = await reviewerHash("clean-user", salt);
    // a bucket that happens to share this reviewer's prefix, but whose
    // listed full hash is someone else's
    const response = {
      matches: { [cleanHash.slice(0, PREFIX_LENGTH)]: ["not-actually-this-users-hash"] },
    };

    const flagged = await matchFlaggedReviewers(["clean-user"], salt, response);

    expect(flagged.size).toBe(0);
  });

  it("treats an absent prefix key the same as an empty bucket", async () => {
    const flagged = await matchFlaggedReviewers(["someone"], "salt", { matches: {} });
    expect(flagged.size).toBe(0);
  });
});
