import { describe, expect, it } from "vitest";
import { reviewerGraphEvidenceRow } from "./reviewerGraphEvidence";

describe("reviewerGraphEvidenceRow", () => {
  it("reports none, not zero, when no review carried a reviewer id", () => {
    expect(reviewerGraphEvidenceRow(0, 0)).toEqual({
      signal: "reviewer network",
      strength: "none",
      value: null,
      detail: "No reviewer identifiers to check against the network.",
    });
  });

  it("hand computed: a high flagged share reads as strong evidence", () => {
    const row = reviewerGraphEvidenceRow(15, 30);
    expect(row).toMatchObject({ signal: "reviewer network", strength: "strong", value: 0.5 });
    expect(row.detail).toContain("50 percent");
  });

  it("hand computed: zero flagged out of many is weak, not none", () => {
    const row = reviewerGraphEvidenceRow(0, 40);
    expect(row).toMatchObject({ strength: "weak", value: 0 });
  });

  it("hand computed: a moderate share", () => {
    const row = reviewerGraphEvidenceRow(6, 30);
    expect(row).toMatchObject({ strength: "moderate", value: 0.2 });
  });
});
