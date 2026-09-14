import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_EDGES_PER_BATCH, MAX_REQUEST_BODY_BYTES } from "../src/graph/submit";
import { BUCKET_COUNT, PREFIX_LENGTH } from "../src/reputation/lookup";
import { DEFAULT_NUM_PERMUTATIONS } from "../src/score/textNearDuplication";

const CONTRACT = resolve(import.meta.dirname, "..", "..", "tests", "contract", "serviceLimits.json");

interface ServiceLimits {
  contributeMaxEdgesPerBatch: number;
  maxRequestBodyBytes: number;
  lookupBucketCount: number;
  lookupPrefixLength: number;
  maxMinhashLength: number;
}

const limits = JSON.parse(readFileSync(CONTRACT, "utf8")) as ServiceLimits;

describe("the limits the service enforces, as the extension sees them", () => {
  it("batches no more edges than the service accepts", () => {
    expect(MAX_EDGES_PER_BATCH).toBe(limits.contributeMaxEdgesPerBatch);
  });

  it("sizes request bodies to the same cap", () => {
    expect(MAX_REQUEST_BODY_BYTES).toBe(limits.maxRequestBodyBytes);
  });

  it("pads lookups to the bucket shape the service expects", () => {
    expect(BUCKET_COUNT).toBe(limits.lookupBucketCount);
    expect(PREFIX_LENGTH).toBe(limits.lookupPrefixLength);
  });

  it("produces signatures the service will not refuse as too long", () => {
    expect(DEFAULT_NUM_PERMUTATIONS).toBeLessThanOrEqual(limits.maxMinhashLength);
  });
});
