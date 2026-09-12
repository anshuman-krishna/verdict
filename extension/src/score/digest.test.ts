import { describe, expect, it } from "vitest";
import { fnv1a32, shortDigest, toBase } from "./digest";

describe("fnv1a32", () => {
  it("hand computed: the empty string is the fnv offset basis", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
  });

  it("hand computed: a single a is the basis xored and multiplied", () => {
    expect(fnv1a32("a")).toBe(0xe40c292c);
  });

  it("stays inside 32 unsigned bits", () => {
    for (const input of ["", "a", "amazon", "a much longer string to fold"]) {
      expect(fnv1a32(input)).toBeGreaterThanOrEqual(0);
      expect(fnv1a32(input)).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("separates inputs that differ by one character", () => {
    expect(fnv1a32("B0ABCDEFGH")).not.toBe(fnv1a32("B0ABCDEFGI"));
  });
});

describe("toBase", () => {
  it("pads to the width asked for", () => {
    expect(toBase(0, 8)).toBe("00000000");
    expect(toBase(1, 4)).toBe("0001");
  });

  it("counts in the alphabet given", () => {
    expect(toBase(35, 2)).toBe("0Z");
    expect(toBase(36, 2)).toBe("10");
  });
});

describe("shortDigest", () => {
  it("is the same for the same input", () => {
    expect(shortDigest("one")).toBe(shortDigest("one"));
  });

  it("differs for different inputs", () => {
    expect(shortDigest("one")).not.toBe(shortDigest("two"));
  });

  it("is readable back off a printed report", () => {
    expect(shortDigest("anything")).toMatch(/^[0-9A-Z]{8}$/);
  });
});
