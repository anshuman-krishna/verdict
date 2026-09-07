import json
import sqlite3
from pathlib import Path

from verdict_service.graph.contribution_store import ContributionEdge

# api/store.py and graph/contribution_store.py each say, in a comment, that
# a real deployment would persist what they hold. This is that. Until now a
# restart lost every contributed edge and every flagged hash, which means a
# service that can never accumulate the ninety days of edges PRIVACY.md
# section 8 describes retaining, and a reputation endpoint that answers
# every lookup with nothing until an hour after the process last started.
#
# SQLite, from the standard library, rather than a database server. The
# write path is one small row per contributed edge arriving at human speed,
# the read path is a prefix lookup over a single indexed column, and the
# recompute is a batch scan. None of that wants a second process to operate,
# back up, and keep patched, and PRIVACY.md section 10 lists server
# compromise as a threat: one file on a volume is a smaller thing to secure
# than a network service. It also adds no dependency, which is worth saying
# out loud rather than discovering later.

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


def connect(path: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(path), check_same_thread=False)
    # wal so the hourly recompute's writes do not block a lookup mid batch,
    # and so a lookup never sees a half applied recompute.
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.executescript(SCHEMA)
    connection.commit()
    return connection


class SqliteContributionEdgeStore:
    """ContributionEdgeStore backed by a file, so edges survive a restart."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection

    def add(self, edge: ContributionEdge) -> None:
        self._connection.execute(
            "INSERT INTO contribution_edges "
            "(reviewer_hash, product_hash, star_rating, week_bucket, verified, "
            "minhash_signature, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                edge.reviewer_hash,
                edge.product_hash,
                edge.star_rating,
                edge.week_bucket,
                # sqlite has no boolean, and None has to survive the round
                # trip as None: PRIVACY.md section 5 sends the verified flag
                # only when the page carried one, and "not stated" is not
                # the same claim as "not verified".
                None if edge.verified is None else int(edge.verified),
                json.dumps(edge.minhash_signature),
                edge.received_at,
            ),
        )
        self._connection.commit()

    def list_since(self, cutoff: float) -> list[ContributionEdge]:
        rows = self._connection.execute(
            "SELECT reviewer_hash, product_hash, star_rating, week_bucket, verified, "
            "minhash_signature, received_at FROM contribution_edges "
            "WHERE received_at >= ? ORDER BY received_at",
            (cutoff,),
        ).fetchall()
        return [_edge(row) for row in rows]

    def prune_older_than(self, cutoff: float) -> int:
        cursor = self._connection.execute(
            "DELETE FROM contribution_edges WHERE received_at < ?", (cutoff,)
        )
        self._connection.commit()
        return cursor.rowcount


class SqliteFlaggedHashStore:
    """FlaggedHashStore backed by a file, so a restart does not unflag everyone."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection

    def matches(self, prefix: str) -> list[str]:
        if prefix == "":
            rows = self._connection.execute("SELECT full_hash FROM flagged_hashes").fetchall()
            return [row[0] for row in rows]
        upper = _prefix_upper_bound(prefix)
        if upper is None:
            # no representable bound, so fall back to comparing in python
            # rather than answering a lookup wrongly. Unreachable through
            # api/reputation.py, which only accepts hex.
            rows = self._connection.execute("SELECT full_hash FROM flagged_hashes").fetchall()
            return [row[0] for row in rows if row[0].startswith(prefix)]
        # a range over the primary key, not LIKE or GLOB. It uses the index,
        # and it cannot be made to mean something else by a prefix
        # containing a pattern character, which matters because a store
        # should not depend on its caller having validated the input.
        rows = self._connection.execute(
            "SELECT full_hash FROM flagged_hashes WHERE full_hash >= ? AND full_hash < ?",
            (prefix, upper),
        ).fetchall()
        return [row[0] for row in rows]

    def add(self, full_hash: str) -> None:
        self._connection.execute(
            "INSERT OR IGNORE INTO flagged_hashes (full_hash) VALUES (?)", (full_hash,)
        )
        self._connection.commit()

    def add_many(self, hashes: list[str]) -> None:
        """record a whole recompute's flagged hashes in one transaction."""
        # graph/recompute.py folds in every hash a run flagged, and a run
        # over a real edge set flags many. One commit each would make an
        # hourly batch job into thousands of fsyncs.
        #
        # Additive, like add, and deliberately not a replace: PRIVACY.md
        # section 8 keeps derived community assignments after their source
        # edges age out of retention, so a hash flagged by a past run must
        # survive a later run that no longer sees the edges which flagged
        # it. There is no remove here for the same reason recompute.py
        # gives: nothing in this pipeline is a considered decision to lift
        # a flag, only an artifact of which edges are still retained.
        with self._connection:
            self._connection.executemany(
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
