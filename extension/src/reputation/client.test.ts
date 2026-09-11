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
      delay: () => Promise.resolve(),
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
      delay: () => Promise.resolve(),
    });
    expect(result).toEqual(new Set());
  });

  it("resolves to an empty set instead of throwing when fetch itself rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const result = await lookupFlaggedReviewers(["someone"], {
      endpoint: "https://x",
      salt: SALT,
      fetchImpl,
      delay: () => Promise.resolve(),
    });
    expect(result).toEqual(new Set());
  });

  it("waits out a random delay before firing the request, PRIVACY.md's stated timing mitigation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ matches: {} }) });
    const delay = vi.fn().mockResolvedValue(undefined);
    const order: string[] = [];
    delay.mockImplementation(() => {
      order.push("delay");
      return Promise.resolve();
    });
    fetchImpl.mockImplementation(() => {
      order.push("fetch");
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ matches: {} }) });
    });

    let counter = 0;
    const varyingRandom = () => {
      counter += 1;
      return (counter % 997) / 997;
    };

    await lookupFlaggedReviewers(["someone"], {
      endpoint: "https://x",
      salt: SALT,
      fetchImpl,
      delay,
      random: varyingRandom,
    });

    expect(delay).toHaveBeenCalledOnce();
    const [waitedMs] = delay.mock.calls[0] as [number];
    expect(waitedMs).toBeGreaterThanOrEqual(200);
    expect(waitedMs).toBeLessThanOrEqual(4000);
    expect(order).toEqual(["delay", "fetch"]);
  });
});

describe("a service that answers too slowly (SPEC.md section 13, service unreachable)", () => {
  it("gives up rather than holding the report open forever", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => new Promise(() => {}));
    const flagged = await lookupFlaggedReviewers(["r1", "r2"], {
      endpoint: "https://api.example.com/lookup",
      salt: "salt",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delay: () => Promise.resolve(),
      timeoutMs: 0,
    });

    expect(flagged.size).toBe(0);
  });

  it("aborts the request it abandoned, so the connection is not left open", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise(() => {});
    });
    await lookupFlaggedReviewers(["r1"], {
      endpoint: "https://api.example.com/lookup",
      salt: "salt",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delay: () => Promise.resolve(),
      timeoutMs: 0,
    });

    expect(signal?.aborted).toBe(true);
  });

  describe("the time a page can spend on the lookup", () => {
    it("stops issuing batches once the budget is spent", async () => {
      let clock = 0;
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ matches: {} }),
      });

      await lookupFlaggedReviewers(
        Array.from({ length: 200 }, (_, i) => `reviewer-${i}`),
        {
          endpoint: "https://x",
          salt: "s",
          fetchImpl: fetchImpl as unknown as typeof fetch,
          random: () => 0.5,
          delay: async (ms) => {
            clock += ms;
          },
          now: () => clock,
          budgetMs: 5_000,
        },
      );

      const spent = fetchImpl.mock.calls.length * 2100;
      expect(spent).toBeLessThanOrEqual(5_000 + 2100);
      expect(fetchImpl.mock.calls.length).toBeGreaterThan(0);
    });

    it("still returns the matches from the batches that did land", async () => {
      let clock = 0;
      const salt = "s";
      const flagged = await reviewerHash("reviewer-0", salt);
      const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const { prefixes } = JSON.parse(init.body as string) as { prefixes: string[] };
        const prefix = flagged.slice(0, 4);
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              matches: prefixes.includes(prefix) ? { [prefix]: [flagged] } : {},
            }),
        });
      });

      const result = await lookupFlaggedReviewers(["reviewer-0"], {
        endpoint: "https://x",
        salt,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        random: () => 0.5,
        delay: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      });

      expect(result.has("reviewer-0")).toBe(true);
    });
  });
});
