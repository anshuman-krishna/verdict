import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyModel, type CombinerModel } from "../src/score/combine";
import { buildFeatureVector } from "../src/score/featureVector";
import type { FeatureVector } from "../src/score/featureVector";
import { ratingDeconvolution } from "../src/score/ratingDeconvolution";
import { detectTemporalBursts } from "../src/score/temporalBurst";
import {
  estimateJaccard,
  minhashSignature,
  shingle,
  textNearDuplication,
} from "../src/score/textNearDuplication";
import { verificationConcentration } from "../src/score/verificationConcentration";

const VECTORS_PATH = fileURLToPath(
  new URL("../../tests/parity/vectors.jsonl", import.meta.url),
);

const CONTINUOUS_TOLERANCE = 1e-6;

interface Vector {
  signal: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

function loadVectors(): Vector[] {
  const text = readFileSync(VECTORS_PATH, "utf-8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Vector);
}

function assertClose(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === "number" && typeof actual === "number") {
    expect(Math.abs(actual - expected), `${path}: ${actual} vs ${expected}`).toBeLessThanOrEqual(
      CONTINUOUS_TOLERANCE,
    );
    return;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    expect(actual.length, `${path}.length`).toBe(expected.length);
    expected.forEach((value, i) => assertClose(actual[i], value, `${path}[${i}]`));
    return;
  }
  if (expected !== null && typeof expected === "object" && actual !== null && typeof actual === "object") {
    for (const key of Object.keys(expected)) {
      assertClose((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${path}.${key}`);
    }
    return;
  }
  expect(actual, path).toEqual(expected);
}

describe("typescript signals against the shared parity vectors", () => {
  for (const [index, vector] of loadVectors().entries()) {
    it(`vector ${index}: ${vector.signal}`, () => {
      const actual = run(vector);
      assertClose(actual, vector.expected, vector.signal);
    });
  }
});

function run(vector: Vector): unknown {
  switch (vector.signal) {
    case "ratingDeconvolution": {
      const { observed, organicPrior, injectionKernel } = vector.input as {
        observed: number[];
        organicPrior: number[];
        injectionKernel: number[];
      };
      return ratingDeconvolution(observed, organicPrior, injectionKernel);
    }
    case "verificationConcentration": {
      const { reviews } = vector.input as {
        reviews: { rating: number | null; verified: boolean | null; insideBurst: boolean }[];
      };
      return verificationConcentration(reviews);
    }
    case "temporalBurst": {
      const { dailyCounts, windowDays, percentile } = vector.input as {
        dailyCounts: number[];
        windowDays: number;
        percentile: number;
      };
      return detectTemporalBursts(dailyCounts, windowDays, percentile);
    }
    case "textNearDuplication": {
      const { reviews } = vector.input as { reviews: { text: string | null }[] };
      return textNearDuplication(reviews);
    }
    case "textNearDuplicationEstimatedJaccard": {
      const { textA, textB, numPermutations } = vector.input as {
        textA: string;
        textB: string;
        numPermutations: number;
      };
      const signatureA = minhashSignature(shingle(textA, 5), numPermutations);
      const signatureB = minhashSignature(shingle(textB, 5), numPermutations);
      return { estimatedJaccard: estimateJaccard(signatureA, signatureB) };
    }
    case "featureVector": {
      const { reviews, organicPrior, injectionKernel } = vector.input as {
        reviews: {
          rating: number | null;
          text: string | null;
          date: string | null;
          verified: boolean | null;
          reviewerId: string | null;
        }[];
        organicPrior: number[];
        injectionKernel: number[];
      };
      const result = buildFeatureVector(reviews, { organicPrior, injectionKernel });
      return {
        meetsMinimumData: result.meetsMinimumData,
        ratingDeconvolution: result.ratingDeconvolution,
        temporalBurst: result.temporalBurst !== null
          ? {
            burstFraction: result.temporalBurst.burstFraction,
            burstCount: result.temporalBurst.burstCount,
            largestBurstShare: result.temporalBurst.largestBurstShare,
          }
          : null,
        verificationConcentration: result.verificationConcentration,
        textNearDuplication: result.textNearDuplication,
      };
    }
    case "combine": {
      const { featureVector, model } = vector.input as {
        featureVector: FeatureVector;
        model: CombinerModel;
      };
      return applyModel(featureVector, model);
    }
    default:
      throw new Error(`unknown signal in parity vectors: ${vector.signal}`);
  }
}
