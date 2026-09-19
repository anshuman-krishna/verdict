import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRY_AFTER_MS,
  MAX_RETRY_AFTER_MS,
  holdUntil,
  retryAfterMs,
} from "./retryAfter";

const NOW = Date.UTC(2026, 2, 18, 12, 0, 0);

describe("retryAfterMs", () => {
  it("reads a count of seconds", () => {
    expect(retryAfterMs("120", NOW)).toBe(120_000);
    expect(retryAfterMs(" 5 ", NOW)).toBe(5000);
    expect(retryAfterMs("0", NOW)).toBe(0);
  });

  it("reads an http date as the wait until then", () => {
    expect(retryAfterMs("Wed, 18 Mar 2026 12:02:00 GMT", NOW)).toBe(120_000);
  });

  it("treats a date already past as no wait at all", () => {
    expect(retryAfterMs("Wed, 18 Mar 2026 11:00:00 GMT", NOW)).toBe(0);
  });

  it("never waits longer than a day, whatever it is told", () => {
    expect(retryAfterMs("99999999", NOW)).toBe(MAX_RETRY_AFTER_MS);
    expect(retryAfterMs("Fri, 18 Mar 2044 12:00:00 GMT", NOW)).toBe(MAX_RETRY_AFTER_MS);
  });

  it("reads nothing out of a header that is not a wait", () => {
    expect(retryAfterMs(null, NOW)).toBeNull();
    expect(retryAfterMs(undefined, NOW)).toBeNull();
    expect(retryAfterMs("", NOW)).toBeNull();
    expect(retryAfterMs("soon", NOW)).toBeNull();
    expect(retryAfterMs("-30", NOW)).toBeNull();
    expect(retryAfterMs("1.5", NOW)).toBeNull();
  });
});

describe("holdUntil", () => {
  it("holds for what the header asked", () => {
    expect(holdUntil("60", NOW)).toBe(NOW + 60_000);
  });

  it("holds for the default when the refusal said nothing readable", () => {
    expect(holdUntil(null, NOW)).toBe(NOW + DEFAULT_RETRY_AFTER_MS);
    expect(holdUntil("whenever", NOW)).toBe(NOW + DEFAULT_RETRY_AFTER_MS);
  });
});
