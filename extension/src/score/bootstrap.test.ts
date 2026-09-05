import { describe, expect, it } from "vitest";
import { bootstrap, interquartileRange, resample } from "./bootstrap";

describe("resample", () => {
  it("hand computed: a random source pinned at 0 always draws the first item", () => {
    expect(resample([10, 20, 30], () => 0)).toEqual([10, 10, 10]);
  });

  it("hand computed: a random source just under 1 always draws the last item", () => {
    expect(resample(["a", "b", "c"], () => 0.999)).toEqual(["c", "c", "c"]);
  });

  it("preserves the input length", () => {
    expect(resample([1, 2, 3, 4, 5], () => 0.5)).toHaveLength(5);
  });

  it("returns an empty array for an empty input", () => {
    expect(resample([], () => 0.5)).toEqual([]);
  });
});

describe("bootstrap", () => {
  it("hand computed: with a pinned random source, every resample is identical", () => {
    const results = bootstrap([1, 2, 3], (sample) => sample.reduce((a, b) => a + b, 0), {
      resamples: 5,
      random: () => 0,
    });
    // resample always draws index 0 (value 1), 3 times, so every sum is 3
    expect(results).toEqual([3, 3, 3, 3, 3]);
  });

  it("defaults to 200 resamples", () => {
    const results = bootstrap([1, 2, 3], (sample) => sample.length, { random: () => 0 });
    expect(results).toHaveLength(200);
  });
});

describe("interquartileRange", () => {
  it("hand computed: 1 through 9 gives a Q1 of 3 and a Q3 of 7", () => {
    expect(interquartileRange([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual({ low: 3, high: 7 });
  });

  it("hand computed: 1 through 4 gives fractional quartiles by linear interpolation", () => {
    // numpy's default percentile method agrees: np.percentile([1,2,3,4], [25,75]) == [1.75, 3.25]
    const result = interquartileRange([1, 2, 3, 4]);
    expect(result.low).toBeCloseTo(1.75, 10);
    expect(result.high).toBeCloseTo(3.25, 10);
  });

  it("does not require the input to be pre-sorted", () => {
    expect(interquartileRange([9, 3, 1, 7, 5, 2, 8, 4, 6])).toEqual({ low: 3, high: 7 });
  });

  it("returns the single value itself for a one element array", () => {
    expect(interquartileRange([42])).toEqual({ low: 42, high: 42 });
  });

  it("returns zero for an empty array", () => {
    expect(interquartileRange([])).toEqual({ low: 0, high: 0 });
  });
});
