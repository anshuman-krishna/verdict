import json
import sqlite3
import threading
from pathlib import Path

from verdict_service.graph.contribution_store import ContributionEdge

SCHEMA = """
CREATE TABLE IF NOT EXISTS contribution_edges (
    id INTEGER PRIMARY KEY,
    reviewer_hash TEXT NOT NULL,
    product_hash TEXT NOT NULL,
    star_rating INTEGER NOT NULL,
    week_bucket INTEGER NOT NULL,
    verified INTEGER,
    minhash_signature TEXT NOT NULL,
    received_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS contribution_edges_received_at
    ON contribution_edges (received_at);

CREATE TABLE IF NOT EXISTS flagged_hashes (
    full_hash TEXT PRIMARY KEY
) WITHOUT ROWID;
"""


class Database:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection
        self._lock = threading.Lock()

    def read(self, sql: str, params: tuple = ()) -> list[tuple]:
        with self._lock:
            return self._connection.execute(sql, params).fetchall()

    def write(self, sql: str, params: tuple = ()) -> int:
        with self._lock, self._connection:
            return self._connection.execute(sql, params).rowcount

    def write_many(self, sql: str, rows: list[tuple]) -> None:
        with self._lock, self._connection:
            self._connection.executemany(sql, rows)


def connect(path: str | Path) -> Database:
    connection = sqlite3.connect(str(path), check_same_thread=False)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.executescript(SCHEMA)
    connection.commit()
    return Database(connection)


class SqliteContributionEdgeStore:
    """ContributionEdgeStore backed by a file, so edges survive a restart."""

    def __init__(self, database: Database) -> None:
        self._database = database

    def add(self, edge: ContributionEdge) -> None:
        self._database.write(
            "INSERT INTO contribution_edges "
            "(reviewer_hash, product_hash, star_rating, week_bucket, verified, "
            "minhash_signature, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                edge.reviewer_hash,
                edge.product_hash,
                edge.star_rating,
                edge.week_bucket,
                None if edge.verified is None else int(edge.verified),
                json.dumps(edge.minhash_signature),
                edge.received_at,
            ),
        )

    def list_since(self, cutoff: float) -> list[ContributionEdge]:
        rows = self._database.read(
            "SELECT reviewer_hash, product_hash, star_rating, week_bucket, verified, "
            "minhash_signature, received_at FROM contribution_edges "
            "WHERE received_at >= ? ORDER BY received_at",
            (cutoff,),
        )
        return [_edge(row) for row in rows]

    def prune_older_than(self, cutoff: float) -> int:
        return self._database.write(
            "DELETE FROM contribution_edges WHERE received_at < ?", (cutoff,)
        )


class SqliteFlaggedHashStore:
    """FlaggedHashStore backed by a file, so a restart does not unflag everyone."""

    def __init__(self, database: Database) -> None:
        self._database = database

    def matches(self, prefix: str) -> list[str]:
        if prefix == "":
            return [row[0] for row in self._database.read("SELECT full_hash FROM flagged_hashes")]
        upper = _prefix_upper_bound(prefix)
        if upper is None:
            rows = self._database.read("SELECT full_hash FROM flagged_hashes")
            return [row[0] for row in rows if row[0].startswith(prefix)]
        rows = self._database.read(
            "SELECT full_hash FROM flagged_hashes WHERE full_hash >= ? AND full_hash < ?",
            (prefix, upper),
        )
        return [row[0] for row in rows]

    def add(self, full_hash: str) -> None:
        self._database.write(
            "INSERT OR IGNORE INTO flagged_hashes (full_hash) VALUES (?)", (full_hash,)
        )

    def add_many(self, hashes: list[str]) -> None:
        """record a whole recompute's flagged hashes in one transaction."""
        self._database.write_many(
            "INSERT OR IGNORE INTO flagged_hashes (full_hash) VALUES (?)",
            [(full_hash,) for full_hash in hashes],
        )


def _edge(row: tuple) -> ContributionEdge:
    return ContributionEdge(
        reviewer_hash=row[0],
        product_hash=row[1],
        star_rating=row[2],
        week_bucket=row[3],
        verified=None if row[4] is None else bool(row[4]),
        minhash_signature=json.loads(row[5]),
        received_at=row[6],
    )


def _prefix_upper_bound(prefix: str) -> str | None:
    last = ord(prefix[-1])
    if last >= 0x10FFFF:
        return None
    return prefix[:-1] + chr(last + 1)
