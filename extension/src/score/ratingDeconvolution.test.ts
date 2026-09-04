import { describe, expect, it } from "vitest";
import { ratingDeconvolution } from "./ratingDeconvolution";

const organicPrior = [0.1, 0.1, 0.2, 0.3, 0.3];
const injectionKernel = [0.0, 0.0, 0.0, 0.3, 0.7];

describe("ratingDeconvolution", () => {
  it("fits a=0 with no residual when observed matches the organic prior exactly", () => {
    const result = ratingDeconvolution(organicPrior, organicPrior, injectionKernel);
    expect(result.injectedShare).toBeCloseTo(0, 10);
    expect(result.residualError).toBeCloseTo(0, 10);
  });

  it("fits a=1 with no residual when observed matches the injection kernel exactly", () => {
    const result = ratingDeconvolution(injectionKernel, organicPrior, injectionKernel);
    expect(result.injectedShare).toBeCloseTo(1, 10);
    expect(result.residualError).toBeCloseTo(0, 10);
  });

  it("fits a=0.5 for an exact midpoint mixture", () => {
    const midpoint = organicPrior.map((p, i) => (p + injectionKernel[i]!) / 2);
    const result = ratingDeconvolution(midpoint, organicPrior, injectionKernel);
    expect(result.injectedShare).toBeCloseTo(0.5, 10);
    expect(result.residualError).toBeCloseTo(0, 10);
  });

  it("clamps a to 1 and reports the leftover residual when observed overshoots the kernel", () => {
    const beyond = injectionKernel.map((k, i) => k + (k - organicPrior[i]!));
    const result = ratingDeconvolution(beyond, organicPrior, injectionKernel);
    expect(result.injectedShare).toBe(1);
    expect(result.residualError).toBeCloseTo(0.20976176963403026, 10);
  });

  it("fits a non trivial share with residual for a noisy histogram", () => {
    const observed = [0.05, 0.08, 0.12, 0.35, 0.4];
    const result = ratingDeconvolution(observed, organicPrior, injectionKernel);
    expect(result.injectedShare).toBeCloseTo(0.2863636363636365, 10);
    expect(result.residualError).toBeCloseTo(0.027419303087755188, 10);
  });

  it("throws on a histogram that is not five bins", () => {
    expect(() => ratingDeconvolution([1, 2, 3], organicPrior, injectionKernel)).toThrow();
  });
});
