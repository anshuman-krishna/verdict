from typing import Protocol


class FlaggedHashStore(Protocol):
    def matches(self, prefix: str) -> list[str]:
        """every flagged full hash whose first characters equal prefix."""
        ...

    def add(self, full_hash: str) -> None:
        """record a hash the graph service flagged."""
        ...


class InMemoryFlaggedHashStore:
    def __init__(self) -> None:
        self._hashes: set[str] = set()

    def matches(self, prefix: str) -> list[str]:
        return [full_hash for full_hash in self._hashes if full_hash.startswith(prefix)]

    def add(self, full_hash: str) -> None:
        self._hashes.add(full_hash)
