// a build constant, not a secret: it ships in the public bundle and any
// value works structurally, since SPEC.md section 8's privacy guarantee
// comes from the k anonymity of the 4 character prefix bucket, not from
// this string being hidden. its only job is domain separation, so a
// hash computed for this lookup never collides with the same reviewer id
// hashed for an unrelated purpose.
export const REPUTATION_SALT = "verdict-reputation-v1";
