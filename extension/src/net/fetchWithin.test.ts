import { describe, expect, it, vi } from "vitest";
import { ANONYMOUS_REQUEST_INIT, DEFAULT_TIMEOUT_MS, fetchJsonWithin, fetchWithin } from "./fetchWithin";

const OK = { ok: true } as Response;

describe("fetchWithin", () => {
  it("returns the response when the service answers in time", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(OK);
    await expect(fetchWithin(fetchImpl, "https://x", { method: "POST" }, 1000)).resolves.toBe(OK);
  });

  it("returns null rather than hanging when the service never answers", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => new Promise(() => {}));
    await expect(fetchWithin(fetchImpl, "https://x", {}, 0)).resolves.toBeNull();
  });

  it("aborts the request it gave up on", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise(() => {});
    });
    await fetchWithin(fetchImpl, "https://x", {}, 0);

    expect(signal?.aborted).toBe(true);
  });

  it("keeps the caller's method, headers, and body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(OK);
    await fetchWithin(fetchImpl, "https://x", { method: "POST", body: "{}" }, 1000);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://x",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("lets a rejection through, so callers keep their own fallback", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(fetchWithin(fetchImpl, "https://x", {}, 1000)).rejects.toThrow("offline");
  });

  it("defaults to a bound short enough to matter", () => {
    expect(DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  describe("what PRIVACY.md section 4 promises every service request looks like", () => {
    it("sends no cookie, no referer, and no cached copy", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(OK);
      await fetchWithin(fetchImpl, "https://x", { method: "POST" }, 1000);

      expect(fetchImpl).toHaveBeenCalledWith(
        "https://x",
        expect.objectContaining({
          credentials: "omit",
          referrer: "",
          referrerPolicy: "no-referrer",
          cache: "no-store",
        }),
      );
    });

    it("does not let a caller opt out of any of it", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(OK);
      await fetchWithin(
        fetchImpl,
        "https://x",
        { credentials: "include", referrerPolicy: "unsafe-url", cache: "force-cache" },
        1000,
      );

      const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
      expect(init.credentials).toBe("omit");
      expect(init.referrerPolicy).toBe("no-referrer");
      expect(init.cache).toBe("no-store");
    });

    it("names every field the guarantee rests on, so removing one fails here", () => {
      expect(ANONYMOUS_REQUEST_INIT).toEqual({
        credentials: "omit",
        referrer: "",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        mode: "cors",
      });
    });
  });
});

describe("fetchJsonWithin", () => {
  it("returns the parsed body when it arrives in time", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ a: 1 }) });
    await expect(fetchJsonWithin(fetchImpl, "https://x", {}, 1000)).resolves.toEqual({
      ok: true,
      status: 200,
      body: { a: 1 },
    });
  });

  it("gives up on a body that never finishes, not only on headers", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) });
    });
    await expect(fetchJsonWithin(fetchImpl, "https://x", {}, 5)).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
  });

  it("does not read the body of a refusal", async () => {
    const json = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json });
    await expect(fetchJsonWithin(fetchImpl, "https://x", {}, 1000)).resolves.toEqual({
      ok: false,
      status: 503,
      body: null,
    });
    expect(json).not.toHaveBeenCalled();
  });

  it("lets a malformed body reject, so callers keep their own fallback", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad");
      },
    });
    await expect(fetchJsonWithin(fetchImpl, "https://x", {}, 1000)).rejects.toThrow("bad");
  });

  it("applies the same anonymous request shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await fetchJsonWithin(fetchImpl, "https://x", { credentials: "include" }, 1000);
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).credentials).toBe("omit");
  });
});

describe("a request abandoned at the deadline", () => {
  it("does not surface its late rejection as unhandled", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      let reject: (error: Error) => void = () => {};
      const fetchImpl = vi.fn().mockImplementation(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail;
          }),
      );
      await expect(fetchWithin(fetchImpl, "https://x", {}, 0)).resolves.toBeNull();
      reject(new Error("aborted"));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
