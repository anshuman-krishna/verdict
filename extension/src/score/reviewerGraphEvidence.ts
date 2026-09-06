import type { EvidenceRow } from "./report";

// SPEC.md 5.6, the reviewer graph signal, and section 4: opt in, off by
// default, version 0.2. Community scoring, step 4 of SPEC.md 5.6 ("scores
// each community on internal density, rating homogeneity, temporal
// clustering, and category incoherence"), decides what makes a community
// "flagged" in the first place and is CLAUDE.md reserved territory,
// untouched here and still unbuilt server side
// (service/verdict_service/graph/community.py stops at detecting
// communities, not scoring them). This file only turns an already
// computed flagged share into an evidence row, the same shape evidence.ts
// produces for the local signals; the weak/moderate/strong cut points
// below are a proposal in that same spirit, not a ratified spec line.

function strengthFromShare(share: number): EvidenceRow["strength"] {
  if (share < 0.1) {
    return "weak";
  }
  if (share < 0.3) {
    return "moderate";
  }
  return "strong";
}

// baseCount is how many reviews carried a reviewer id at all, since a
// review with none could never be looked up. None strength when there was
// nothing to check, not when the check found nothing: those are different
// facts, same as every other evidence row in evidence.ts.
export function reviewerGraphEvidenceRow(flaggedCount: number, baseCount: number): EvidenceRow {
  if (baseCount === 0) {
    return {
      signal: "reviewer network",
      strength: "none",
      value: null,
      detail: "No reviewer identifiers to check against the network.",
    };
  }
  const share = flaggedCount / baseCount;
  const percent = Math.round(share * 100);
  return {
    signal: "reviewer network",
    strength: strengthFromShare(share),
    value: share,
    detail: `About ${percent} percent of reviewers here also appear in networks flagged across many products.`,
  };
}
