import hashlib

# SPEC.md section 8: "h = sha256(reviewer_id + salt), computed locally"
# by the extension (extension/src/reputation/lookup.ts's reviewerHash).
# This is the server side mirror, used only to populate a FlaggedHashStore
# with hashes in the exact format a lookup request will later be matched
# against: same concatenation, same algorithm, same lower case hex
# encoding. The salt itself is a public build constant
# (extension/src/reputation/salt.ts), not a secret this function protects.


def reviewer_hash(reviewer_id: str, salt: str) -> str:
    return hashlib.sha256(f"{reviewer_id}{salt}".encode()).hexdigest()
