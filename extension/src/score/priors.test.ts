import { describe, expect, it } from "vitest";
import {
  DEFAULT_INJECTION_KERNEL,
  DEFAULT_ORGANIC_PRIOR,
  PRIORS_DOCUMENT,
  priorsFor,
  resolvePriors,
  type PriorsDocument,
} from "./priors";

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

const DOCUMENT: PriorsDocument = {
  default: { organicPrior: [0.2, 0.2, 0.2, 0.2, 0.2], injectionKernel: [0, 0, 0, 0.35, 0.65] },
  aliases: { "küche-haushalt-wohnen": "home-kitchen", "cuisine-et-maison": "home-kitchen" },
  categories: {
    "home-kitchen": { organicPrior: [0.05, 0.05, 0.1, 0.3, 0.5] },
    "espresso-machines": {
      organicPrior: [0.1, 0.1, 0.1, 0.3, 0.4],
      injectionKernel: [0, 0, 0, 0.2, 0.8],
    },
  },
};

describe("the default priors", () => {
  it("are both five bin histograms that sum to one", () => {
    expect(DEFAULT_ORGANIC_PRIOR).toHaveLength(5);
    expect(DEFAULT_INJECTION_KERNEL).toHaveLength(5);
    expect(sum(DEFAULT_ORGANIC_PRIOR)).toBeCloseTo(1);
    expect(sum(DEFAULT_INJECTION_KERNEL)).toBeCloseTo(1);
  });

  it("concentrates the injection kernel on four and five stars, per SPEC.md 5.1", () => {
    expect(DEFAULT_INJECTION_KERNEL[0]).toBe(0);
    expect(DEFAULT_INJECTION_KERNEL[1]).toBe(0);
    expect(DEFAULT_INJECTION_KERNEL[2]).toBe(0);
    expect(DEFAULT_INJECTION_KERNEL[4]).toBeGreaterThan(DEFAULT_INJECTION_KERNEL[3] as number);
  });
});

describe("the shipped priors document", () => {
  it("holds only five bin histograms that sum to one", () => {
    for (const [key, entry] of Object.entries(PRIORS_DOCUMENT.categories)) {
      expect(entry.organicPrior, key).toHaveLength(5);
      expect(sum(entry.organicPrior), key).toBeCloseTo(1);
      if (entry.injectionKernel !== undefined) {
        expect(entry.injectionKernel, key).toHaveLength(5);
        expect(sum(entry.injectionKernel), key).toBeCloseTo(1);
      }
    }
  });

  it("aliases only onto keys that carry an estimate", () => {
    for (const [from, to] of Object.entries(PRIORS_DOCUMENT.aliases)) {
      expect(PRIORS_DOCUMENT.categories[to], `${from} points at ${to}`).toBeDefined();
    }
  });

  it("holds keys in the shape the lookup derives from a page", () => {
    for (const key of Object.keys(PRIORS_DOCUMENT.categories)) {
      expect(resolvePriors(key).key).toBe(key);
    }
  });

  // week 4 has not run, so every listing is still scored against the one shape
  it("falls back to the default until a corpus fills it", () => {
    expect(priorsFor("Home & Kitchen").inputs.organicPrior).toEqual(DEFAULT_ORGANIC_PRIOR);
  });
});

describe("resolving a prior from a category trail", () => {
  it("takes the narrowest segment that carries an estimate", () => {
    const resolved = resolvePriors("Home & Kitchen > Espresso Machines", DOCUMENT);
    expect(resolved.key).toBe("espresso-machines");
    expect(resolved.inputs.injectionKernel).toEqual([0, 0, 0, 0.2, 0.8]);
  });

  it("walks out to the parent when the narrow segment has none", () => {
    const resolved = resolvePriors("Home & Kitchen > Kettles > Stovetop", DOCUMENT);
    expect(resolved.key).toBe("home-kitchen");
  });

  it("inherits the default injection kernel where an entry states none", () => {
    expect(resolvePriors("Home & Kitchen", DOCUMENT).inputs.injectionKernel).toEqual(
      DOCUMENT.default.injectionKernel,
    );
  });

  it("reaches one estimate from another locale's wording", () => {
    expect(resolvePriors("Küche, Haushalt & Wohnen", DOCUMENT).key).toBe("home-kitchen");
    expect(resolvePriors("Cuisine et Maison > Bouilloires", DOCUMENT).key).toBe("home-kitchen");
  });

  it("says nothing matched rather than guessing", () => {
    expect(resolvePriors("Paperback Fiction", DOCUMENT).key).toBeNull();
    expect(resolvePriors(null, DOCUMENT).key).toBeNull();
    expect(resolvePriors("", DOCUMENT).inputs.organicPrior).toEqual(DOCUMENT.default.organicPrior);
  });

  it("does not loop on an alias cycle", () => {
    const cyclic: PriorsDocument = {
      ...DOCUMENT,
      aliases: { a: "b", b: "a" },
    };
    expect(resolvePriors("a", cyclic).key).toBeNull();
  });
});
