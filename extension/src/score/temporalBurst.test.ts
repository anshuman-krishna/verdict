import { describe, expect, it } from "vitest";
import { detectTemporalBursts, poissonQuantile } from "./temporalBurst";

describe("poissonQuantile", () => {
  it("is 0 for a lambda of 0, the degenerate distribution", () => {
    expect(poissonQuantile(0, 0.99)).toBe(0);
  });

  it("matches known 99th percentile values", () => {
    expect(poissonQuantile(1, 0.99)).toBe(4);
    expect(poissonQuantile(2, 0.99)).toBe(6);
    expect(poissonQuantile(5, 0.99)).toBe(11);
    expect(poissonQuantile(10, 0.99)).toBe(18);
  });
});

describe("detectTemporalBursts", () => {
  it("flags a single three day spike as one burst", () => {
    const daily = [...Array(30).fill(2), 50, 50, 50, ...Array(7).fill(2)];
    const result = detectTemporalBursts(daily);
    expect(result.bursts).toEqual([{ startDay: 30, endDay: 32, reviewCount: 150 }]);
    expect(result.burstCount).toBe(1);
    expect(result.burstFraction).toBeCloseTo(0.6696428571428571, 10);
    expect(result.largestBurstShare).toBeCloseTo(0.6696428571428571, 10);
  });

  it("merges nothing across a return to baseline, reporting two separate bursts", () => {
    const daily = [
      ...Array(30).fill(3),
      40,
      ...Array(10).fill(3),
      60,
      60,
      ...Array(10).fill(3),
    ];
    const result = detectTemporalBursts(daily);
    expect(result.bursts).toEqual([
      { startDay: 30, endDay: 30, reviewCount: 40 },
      { startDay: 41, endDay: 42, reviewCount: 120 },
    ]);
    expect(result.burstCount).toBe(2);
    expect(result.burstFraction).toBeCloseTo(0.5161290322580645, 10);
    expect(result.largestBurstShare).toBeCloseTo(0.3870967741935484, 10);
  });

  it("flags nothing for a flat series with no spikes", () => {
    const daily = Array(40).fill(5);
    const result = detectTemporalBursts(daily);
    expect(result.burstCount).toBe(0);
    expect(result.burstFraction).toBe(0);
  });

  it("flags nothing and divides by zero safely for an all zero series", () => {
    const result = detectTemporalBursts(Array(10).fill(0));
    expect(result).toEqual({
      bursts: [],
      burstFraction: 0,
      burstCount: 0,
      largestBurstShare: 0,
    });
  });

  it("never flags day zero, which has no preceding history", () => {
    const result = detectTemporalBursts([1000]);
    expect(result.burstCount).toBe(0);
  });
});
