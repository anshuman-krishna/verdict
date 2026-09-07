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

    // one tick past the oldest hit's window, so exactly one allowance
    // comes back and no more
    time.advance(windowMs + 1);
    expect(limiter.allow("https://verdict.tools", "verdict:analyze")).toBe(true);
  });

  // a rejected caller that still spent an allowance could hold itself out
  // indefinitely by retrying, which is a worse failure than the limit.
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

  // externally_connectable allows every localhost port, so the map of
  // tracked origins has to be bounded.
  it("stops tracking the least recently seen origin past its cap", () => {
    const time = clock();
    const limiter = new BridgeRateLimiter(time.now);
    for (let port = 0; port < 200; port += 1) {
      time.advance(1);
      limiter.allow(`http://localhost:${port}`, "verdict:analyze");
    }
    // the earliest origin was evicted, so it starts fresh rather than
    // being remembered forever
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
