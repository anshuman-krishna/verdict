// a build constant, not a secret: the k anonymity of the prefix bucket is the guarantee, not this.
// shared by lookup and contribution deliberately, and they must agree rather than merely not
// collide: a community means nothing to a lookup unless it was flagged under the hash being queried,
// and the service never sees a raw reviewer id to re-hash. separate salts would make the two
// protocols structurally unable to agree, which breaks the feature rather than protecting it
export const REPUTATION_SALT = "verdict-reputation-v1";
