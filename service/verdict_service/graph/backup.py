import time
from collections.abc import Callable
from pathlib import Path

from verdict_service.graph.sqlite_store import Database

DEFAULT_RETAINED_BACKUPS = 7


def backup_filename(now: float) -> str:
    return f"verdict-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime(now))}.db"


def run_backup(
    database: Database,
    destination_dir: Path,
    now: Callable[[], float] = time.time,
    retained: int = DEFAULT_RETAINED_BACKUPS,
) -> Path:
    """Writes a timestamped snapshot of database and prunes older ones.

    flagged_hashes is the one table recompute.py never prunes, so the
    single-file volume backing it is the only copy of months of derived
    community assignments unless something like this exists.
    """
    destination_dir.mkdir(parents=True, exist_ok=True)
    target = destination_dir / backup_filename(now())
    database.backup_to(target)
    prune_backups(destination_dir, retained)
    return target


def prune_backups(destination_dir: Path, retained: int) -> None:
    backups = sorted(destination_dir.glob("verdict-*.db"))
    stale = backups[:-retained] if retained > 0 else backups
    for path in stale:
        path.unlink()
