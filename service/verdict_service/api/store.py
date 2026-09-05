from typing import Protocol

# a flagged hash is sha256(reviewer_id + salt), computed by the extension
# and never reversible here since this process never sees a reviewer id
# or the salt that produced any given hash.


class FlaggedHashStore(Protocol):
    def matches(self, prefix: str) -> list[str]:
        """every flagged full hash whose first characters equal prefix."""
        ...

    def add(self, full_hash: str) -> None:
        """record a hash the graph service flagged."""
        ...


# the graph service that would populate this (SPEC.md section 5.6,
# PLAN.md week 9) does not exist yet, so every deployment starts with an
# empty set. a real store would persist this and be written to only by
# the opt in ingestion path, never by a lookup request.
class InMemoryFlaggedHashStore:
    def __init__(self) -> None:
        self._hashes: set[str] = set()

    def matches(self, prefix: str) -> list[str]:
        return [full_hash for full_hash in self._hashes if full_hash.startswith(prefix)]

    def add(self, full_hash: str) -> None:
        self._hashes.add(full_hash)
