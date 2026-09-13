import shutil
import sqlite3
from pathlib import Path

REQUIRED_TABLES = frozenset({"contribution_edges", "flagged_hashes"})


class RestoreError(Exception):
    """Something about the requested restore cannot be done safely."""


def latest_backup(backup_dir: Path) -> Path:
    backups = sorted(backup_dir.glob("verdict-*.db")) if backup_dir.is_dir() else []
    if not backups:
        raise RestoreError(f"no backups found in {backup_dir}")
    return backups[-1]


def _validate(backup_path: Path) -> None:
    if not backup_path.exists():
        raise RestoreError(f"backup not found: {backup_path}")
    try:
        connection = sqlite3.connect(f"file:{backup_path}?mode=ro", uri=True)
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master")}
    except sqlite3.DatabaseError as error:
        raise RestoreError(f"{backup_path} is not a readable database: {error}") from error
    finally:
        connection.close()
    missing = REQUIRED_TABLES - tables
    if missing:
        raise RestoreError(f"{backup_path} is missing tables: {sorted(missing)}")


def restore_database(backup_path: Path, database_path: Path, force: bool = False) -> None:
    """Copies a validated backup over database_path.

    The same check a fresh boot would make (sqlite_store.connect fails
    loudly on a file that is not a database) runs here first, before
    anything on disk is touched, so a bad backup is refused rather than
    used to overwrite a database that still worked.
    """
    _validate(backup_path)
    if database_path.exists() and not force:
        raise RestoreError(f"{database_path} already exists, pass force=True to overwrite")
    database_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(backup_path, database_path)
    for suffix in ("-wal", "-shm"):
        stale = database_path.with_name(database_path.name + suffix)
        if stale.exists():
            stale.unlink()
