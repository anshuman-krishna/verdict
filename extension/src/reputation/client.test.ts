import { describe, expect, it, vi } from "vitest";
import { lookupFlaggedReviewers } from "./client";
import { reviewerHash } from "./lookup";

const SALT = "test-salt";

describe("lookupFlaggedReviewers", () => {
  it("returns an empty set without calling fetch when there are no reviewer ids", async () => {
    const fetchImpl = vi.fn();
    const result = await lookupFlaggedReviewers([], { endpoint: "https://x", salt: SALT, fetchImpl });
    expect(result).toEqual(new Set());
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts a request and resolves flagged reviewer ids from the response", async () => {
    const flaggedHash = await reviewerHash("bad-actor", SALT);
    const prefix = flaggedHash.slice(0, 4);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ matches: { [prefix]: [flaggedHash] } }),
    });

    // buildLookupRequest pads up to 32 distinct prefixes and needs a
    // random source that actually varies to terminate; a constant like
    // () => 0.5 makes every padded prefix identical and hangs forever.
    let counter = 0;
    const varyingRandom = () => {
      counter += 1;
      return (counter % 997) / 997;
    };

    const result = await lookupFlaggedReviewers(["bad-actor", "clean-reviewer"], {
      endpoint: "https://api.verdict.tools/v1/reputation/lookup",
      salt: SALT,
      fetchImpl,
      random: varyingRandom,
    });

    expect(result).toEqual(new Set(["bad-actor"]));
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.verdict.tools/v1/reputation/lookup",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.prefixes).toHaveLength(32);
  });

  it("resolves to an empty set when the service responds with an error status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
    const result = await lookupFlaggedReviewers(["someone"], {
      endpoint: "https://x",
      salt: SALT,
      fetchImpl,
    });
    expect(result).toEqual(new Set());
  });

  it("resolves to an empty set instead of throwing when fetch itself rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const result = await lookupFlaggedReviewers(["someone"], {
      endpoint: "https://x",
      salt: SALT,
      fetchImpl,
    });
    expect(result).toEqual(new Set());
  });
});
