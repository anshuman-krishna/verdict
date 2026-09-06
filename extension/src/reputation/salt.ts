// a build constant, not a secret: it ships in the public bundle and any
// value works structurally, since SPEC.md section 8's privacy guarantee
// comes from the k anonymity of the 4 character prefix bucket, not from
// this string being hidden.
//
// Shared, deliberately, by two protocols: SPEC.md section 8's reputation
// lookup (asking sha256(reviewer_id + this) against a flagged set) and
// PRIVACY.md section 5's graph contribution (submitting sha256(reviewer_id
// + this) as a graph node). They have to agree, not just avoid colliding:
// a flagged community's members only mean anything to a lookup if the
// hash it queries is the exact same hash the community was flagged
// under, and the service never sees a raw reviewer_id to re-hash later
// (service/verdict_service/graph/pipeline.py's
// compute_flagged_hashes_from_contributions takes the client's hash as
// final, not an intermediate value). An earlier version of this file
// gave graph contribution its own separate salt on the theory that
// domain separation was strictly safer; that was wrong here specifically
// because it made the two protocols structurally unable to ever agree on
// anything, which breaks the feature rather than protecting it.
export const REPUTATION_SALT = "verdict-reputation-v1";
