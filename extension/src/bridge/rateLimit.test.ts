import { describe, expect, it } from "vitest";
import { BridgeRateLimiter, RATE_LIMITS } from "./rateLimit";

function clock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("BridgeRateLimiter", () => {
  it("allows requests up to the limit for a message type", () => {
    const limiter = new BridgeRateLimiter(clock().now);
    const { limit } = RATE_LIMITS["verdict:analyze"];
    for (let index = 0; index < limit; index += 1) {
      expect(limiter.allow("https://verdict.tools", "verdict:analyze")).toBe(true);
    }
    expect(limiter.allow("https://verdict.tools", "verdict:analyze")).toBe(false);
  });

  it("keeps a separate budget per origin", () => {
    const limiter = new BridgeRateLimiter(clock().now);
    const { limit } = RATE_LIMITS["verdict:analyze"];
    for (let index = 0; index < limit; index += 1) {
      limiter.allow("http://localhost:4321", "verdict:analyze");
    }
    expect(limiter.allow("http://localhost:4321", "verdict:analyze")).toBe(false);
    expect(limiter.allow("https://verdict.tools", "verdict:analyze")).toBe(true);
  });

  it("keeps a separate budget per message type", () => {
    const limiter = new BridgeRateLimiter(clock().now);
    for (let index = 0; index < RATE_LIMITS["verdict:analyze"].limit; index += 1) {
      limiter.allow("https://verdict.tools", "verdict:analyze");
    }
    expect(limiter.allow("https://verdict.tools", "verdict:analyze")).toBe(false);
    expect(limiter.allow("https://verdict.tools", "verdict:history:list")).toBe(true);
  });

  it("lets the window slide rather than resetting on a fixed boundary", () => {
    const time = clock();
    const limiter = new BridgeRateLimiter(time.now);
    const { limit, windowMs } = RATE_LIMITS["verdict:analyze"];
    for (let index = 0; index < limit; index += 1) {
      limiter.allow("https://verdict.tools", "verdict:analyze");
    }
    expect(limiter.allow("https://verdict.tools", "verdict:analyze")).toBe(false);

    time.advance(windowMs + 1);
    expect(limiter.allow("https://verdict.tools", "verdict:analyze")).toBe(true);
  });

  it("consumes nothing on a rejected request", () => {
    const time = clock();
    const limiter = new BridgeRateLimiter(time.now);
    const { limit, windowMs } = RATE_LIMITS["verdict:analyze"];
    for (let index = 0; index < limit; index += 1) {
      limiter.allow("https://verdict.tools", "verdict:analyze");
    }
    for (let index = 0; index < 100; index += 1) {
      limiter.allow("https://verdict.tools", "verdict:analyze");
    }
    time.advance(windowMs + 1);
    expect(limiter.allow("https://verdict.tools", "verdict:analyze")).toBe(true);
  });

  it("gives history reads a larger allowance than analyses", () => {
    expect(RATE_LIMITS["verdict:history:list"].limit).toBeGreaterThan(
      RATE_LIMITS["verdict:analyze"].limit,
    );
  });

  it("stops tracking the least recently seen origin past its cap", () => {
    const time = clock();
    const limiter = new BridgeRateLimiter(time.now);
    for (let port = 0; port < 200; port += 1) {
      time.advance(1);
      limiter.allow(`http://localhost:${port}`, "verdict:analyze");
    }
    expect(limiter.allow("http://localhost:0", "verdict:analyze")).toBe(true);
  });

  it("does not evict an origin that is still active", () => {
    const time = clock();
    const limiter = new BridgeRateLimiter(time.now);
    const { limit } = RATE_LIMITS["verdict:analyze"];
    for (let index = 0; index < limit; index += 1) {
      limiter.allow("https://verdict.tools", "verdict:analyze");
    }
    for (let port = 0; port < 20; port += 1) {
      time.advance(1);
      limiter.allow(`http://localhost:${port}`, "verdict:analyze");
      time.advance(1);
      limiter.allow("https://verdict.tools", "verdict:history:list");
    }
    expect(limiter.allow("https://verdict.tools", "verdict:analyze")).toBe(false);
  });
});

describe("a limit that outlives the worker", () => {
  const SITE = "https://verdict.tools";

  it("carries a spent budget across a restart", () => {
    const time = clock();
    const before = new BridgeRateLimiter(time.now);
    const { limit } = RATE_LIMITS["verdict:analyze"];
    for (let index = 0; index < limit; index += 1) {
      before.allow(SITE, "verdict:analyze");
    }

    const after = BridgeRateLimiter.restore(JSON.parse(JSON.stringify(before.snapshot())), time.now);

    expect(after.allow(SITE, "verdict:analyze")).toBe(false);
  });

  it("lets the budget come back once the window has passed", () => {
    const time = clock();
    const before = new BridgeRateLimiter(time.now);
    const { limit, windowMs } = RATE_LIMITS["verdict:analyze"];
    for (let index = 0; index < limit; index += 1) {
      before.allow(SITE, "verdict:analyze");
    }
    const saved = before.snapshot();
    time.advance(windowMs + 1);

    expect(BridgeRateLimiter.restore(saved, time.now).allow(SITE, "verdict:analyze")).toBe(true);
  });

  it("keeps nothing that no longer counts", () => {
    const time = clock();
    const limiter = new BridgeRateLimiter(time.now);
    limiter.allow(SITE, "verdict:analyze");
    time.advance(RATE_LIMITS["verdict:analyze"].windowMs + 1);

    expect(limiter.snapshot()).toEqual({});
  });

  it("starts empty from anything that is not a snapshot", () => {
    for (const value of [undefined, null, 7, "x", [], { [SITE]: [] }, { [SITE]: { "verdict:analyze": "x" } }]) {
      const limiter = BridgeRateLimiter.restore(value, clock().now);
      expect(limiter.snapshot()).toEqual({});
    }
  });

  it("ignores message types this build does not have, and stamps that are not times", () => {
    const time = clock();
    const limiter = BridgeRateLimiter.restore(
      { [SITE]: { "verdict:unknown": [time.now()], "verdict:analyze": ["soon", Number.NaN, time.now()] } },
      time.now,
    );

    expect(limiter.snapshot()).toEqual({ [SITE]: { "verdict:analyze": [time.now()] } });
  });

  it("does not let a stamp far in the future lock the site out", () => {
    const time = clock();
    const { limit } = RATE_LIMITS["verdict:analyze"];
    const future = Array.from({ length: limit }, () => time.now() + 365 * 86_400_000);

    const limiter = BridgeRateLimiter.restore({ [SITE]: { "verdict:analyze": future } }, time.now);

    expect(limiter.allow(SITE, "verdict:analyze")).toBe(true);
  });

  it("never restores more hits than the limit allows", () => {
    const time = clock();
    const { limit } = RATE_LIMITS["verdict:analyze"];
    const many = Array.from({ length: limit * 10 }, () => time.now());

    const limiter = BridgeRateLimiter.restore({ [SITE]: { "verdict:analyze": many } }, time.now);

    expect(limiter.snapshot()[SITE]?.["verdict:analyze"]).toHaveLength(limit);
  });
});
