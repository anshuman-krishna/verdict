import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContributionEdge } from "../src/graph/edge";
import type { Review } from "../src/extract/types";


const CONTRACT = resolve(import.meta.dirname, "..", "..", "tests", "contract", "contributionBatch.json");

interface ContractBatch {
  edges: Record<string, unknown>[];
}

const contract = JSON.parse(readFileSync(CONTRACT, "utf8")) as ContractBatch;

const review: Review = {
  rating: 5,
  text: "a review with enough words in it to produce a signature",
  date: "2025-11-03",
  verified: true,
  reviewerId: "amzn1.account.AAA",
};

describe("the contribution wire format", () => {
  it("builds an edge whose keys are exactly the contract's", async () => {
    const edge = await buildContributionEdge(review, "B0ABCDEF12", "a-salt");
    expect(edge).not.toBeNull();
    expect(Object.keys(edge as object).sort()).toEqual(
      Object.keys(contract.edges[0] as object).sort(),
    );
  });

  it("sends the batch under the key the service reads", () => {
    expect(Object.keys(contract)).toEqual(["edges"]);
  });

  it("uses camel case throughout, since the sender is javascript", () => {
    for (const edge of contract.edges) {
      for (const key of Object.keys(edge)) {
        expect(key, key).not.toContain("_");
      }
    }
  });

  it("agrees with the contract on the type of every field", async () => {
    const edge = (await buildContributionEdge(review, "B0ABCDEF12", "a-salt")) as unknown as Record<
      string,
      unknown
    >;
    const sample = contract.edges[0] as Record<string, unknown>;
    for (const [key, value] of Object.entries(sample)) {
      if (value === null) {
        continue;
      }
      expect(typeof edge[key], key).toBe(typeof value);
    }
  });

  it("produces hashes the same length as the contract's, which the service validates", async () => {
    const edge = await buildContributionEdge(review, "B0ABCDEF12", "a-salt");
    const sample = contract.edges[0] as { reviewerHash: string; productHash: string };
    expect(edge?.reviewerHash).toHaveLength(sample.reviewerHash.length);
    expect(edge?.productHash).toHaveLength(sample.productHash.length);
  });
});
