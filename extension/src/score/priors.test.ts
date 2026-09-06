import { describe, expect, it } from "vitest";
import { PLACEHOLDER_INJECTION_KERNEL, PLACEHOLDER_ORGANIC_PRIOR } from "./priors";

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

describe("placeholder priors", () => {
  it("are both five bin histograms that sum to one", () => {
    expect(PLACEHOLDER_ORGANIC_PRIOR).toHaveLength(5);
    expect(PLACEHOLDER_INJECTION_KERNEL).toHaveLength(5);
    expect(sum(PLACEHOLDER_ORGANIC_PRIOR)).toBeCloseTo(1);
    expect(sum(PLACEHOLDER_INJECTION_KERNEL)).toBeCloseTo(1);
  });

  it("concentrates the injection kernel on four and five stars, per SPEC.md 5.1", () => {
    expect(PLACEHOLDER_INJECTION_KERNEL[0]).toBe(0);
    expect(PLACEHOLDER_INJECTION_KERNEL[1]).toBe(0);
    expect(PLACEHOLDER_INJECTION_KERNEL[2]).toBe(0);
    expect(PLACEHOLDER_INJECTION_KERNEL[4]).toBeGreaterThan(PLACEHOLDER_INJECTION_KERNEL[3] as number);
  });
});
