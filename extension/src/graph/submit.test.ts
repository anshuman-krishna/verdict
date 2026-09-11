import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { ContributionEdge } from "./edge";
import { deleteContributions, enqueueContributionEdges, listDueContributions } from "./queue";
import { flushDueContributions } from "./submit";

const FAR_FUTURE = 10_000_000_000_000;

const optedIn = async () => true;

async function clearQueue(): Promise<void> {
  const due = await listDueContributions(FAR_FUTURE);
  await deleteContributions(due.map((d) => d.id));
}

function edge(overrides: Partial<ContributionEdge> = {}): ContributionEdge {
  return {
    reviewerHash: "a".repeat(64),
    productHash: "b".repeat(64),
    starRating: 5,
    weekBucket: 2800,
    verified: true,
    minhashSignature: [],
    ...overrides,
  };
}

describe("flushDueContributions", () => {
  it("does nothing, and never calls fetch, when nothing is due", async () => {
    await clearQueue();
    const fetchImpl = vi.fn();
    const result = await flushDueContributions({ endpoint: "https://x", isEnabled: optedIn, fetchImpl });
    expect(result).toEqual({ submitted: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts every due edge in one request body and clears them from the queue on success", async () => {
    await clearQueue();
    await enqueueContributionEdges([edge({ starRating: 1 }), edge({ starRating: 2 })], () => 1_000_000, () => 0);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });

    const result = await flushDueContributions({
      endpoint: "https://api.verdict.tools/v1/graph/contribute",
      fetchImpl,
      isEnabled: optedIn,
      now: () => FAR_FUTURE,
    });

    expect(result).toEqual({ submitted: 2 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.verdict.tools/v1/graph/contribute",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.edges).toHaveLength(2);
    expect(await listDueContributions(FAR_FUTURE)).toEqual([]);
  });

  it("never sends a cookie, session header, or any client identifier", async () => {
    await clearQueue();
    await enqueueContributionEdges([edge()], () => 1_000_000, () => 0);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });

    await flushDueContributions({ endpoint: "https://x", isEnabled: optedIn, fetchImpl, now: () => FAR_FUTURE });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).not.toBe("include");
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(["content-type"]);
  });

  it("leaves due edges queued for the next attempt when the service responds with an error status", async () => {
    await clearQueue();
    await enqueueContributionEdges([edge()], () => 1_000_000, () => 0);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });

    const result = await flushDueContributions({ endpoint: "https://x", isEnabled: optedIn, fetchImpl, now: () => FAR_FUTURE });

    expect(result).toEqual({ submitted: 0 });
    expect(await listDueContributions(FAR_FUTURE)).toHaveLength(1);
  });

  it("leaves due edges queued instead of throwing when fetch itself rejects", async () => {
    await clearQueue();
    await enqueueContributionEdges([edge()], () => 1_000_000, () => 0);
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));

    const result = await flushDueContributions({ endpoint: "https://x", isEnabled: optedIn, fetchImpl, now: () => FAR_FUTURE });

    expect(result).toEqual({ submitted: 0 });
    expect(await listDueContributions(FAR_FUTURE)).toHaveLength(1);
  });
});

describe("a service that never answers", () => {
  it("leaves the queue intact instead of hanging on the flush", async () => {
    await clearQueue();
    const fetchImpl = vi.fn().mockImplementation(() => new Promise(() => {}));
    await enqueueContributionEdges([edge()]);

    const result = await flushDueContributions({
      endpoint: "https://api.example.com/contribute",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isEnabled: optedIn,
      now: () => FAR_FUTURE,
      timeoutMs: 0,
    });

    expect(result.submitted).toBe(0);
    expect(await listDueContributions(FAR_FUTURE)).toHaveLength(1);
  });

  describe("after the user turns contribution off", () => {
    it("sends nothing that was already queued, and empties the queue", async () => {
      await clearQueue();
      await enqueueContributionEdges([edge()], () => 1_000_000, () => 0);
      const fetchImpl = vi.fn();

      const result = await flushDueContributions({
        endpoint: "https://x",
        fetchImpl,
        isEnabled: async () => false,
        now: () => FAR_FUTURE,
      });

      expect(result).toEqual({ submitted: 0 });
      expect(fetchImpl).not.toHaveBeenCalled();
      await expect(listDueContributions(FAR_FUTURE)).resolves.toEqual([]);
    });
  });

  describe("a batch the service will never accept", () => {
    it("drops it rather than retrying it every alarm forever", async () => {
      await clearQueue();
      await enqueueContributionEdges([edge()], () => 1_000_000, () => 0);
      const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 422 });

      const result = await flushDueContributions({
        endpoint: "https://x",
        isEnabled: optedIn,
        fetchImpl,
        now: () => FAR_FUTURE,
      });

      expect(result).toEqual({ submitted: 0 });
      await expect(listDueContributions(FAR_FUTURE)).resolves.toEqual([]);
    });

    it("keeps the queue when the service is merely having a bad day", async () => {
      await clearQueue();
      await enqueueContributionEdges([edge()], () => 1_000_000, () => 0);
      const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });

      await flushDueContributions({
        endpoint: "https://x",
        isEnabled: optedIn,
        fetchImpl,
        now: () => FAR_FUTURE,
      });

      await expect(listDueContributions(FAR_FUTURE)).resolves.toHaveLength(1);
    });
  });
});
