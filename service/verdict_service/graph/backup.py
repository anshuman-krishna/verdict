import calendar
import fcntl
import os
import re
import sqlite3
import time
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from verdict_service.graph.integrity import database_problems, fsync_directory, fsync_file
from verdict_service.graph.sqlite_store import Database, copy_database

DEFAULT_RETAINED_BACKUPS = 7
BACKUP_INTERVAL_SECONDS = 24 * 60 * 60
BACKUP_DIR_ENV = "VERDICT_BACKUP_DIR"

_TIMESTAMP_FORMAT = "%Y%m%dT%H%M%SZ"
_BACKUP_NAME = re.compile(r"^verdict-(\d{8}T\d{6}Z)\.db$")
_PARTIAL_SUFFIX = ".partial"
_DIRECTORY_LOCK = ".backup.lock"


class BackupError(RuntimeError):
    pass


@dataclass(frozen=True)
class BackupFile:
    path: Path
    taken_at: float
    size_bytes: int


def backup_filename(now: float) -> str:
    return f"verdict-{time.strftime(_TIMESTAMP_FORMAT, time.gmtime(now))}.db"


def backup_time(path: Path) -> float | None:
    match = _BACKUP_NAME.match(path.name)
    if match is None:
        return None
    try:
        return float(calendar.timegm(time.strptime(match.group(1), _TIMESTAMP_FORMAT)))
    except ValueError:
        return None


def default_backup_dir(database_path: Path) -> Path:
    configured = os.environ.get(BACKUP_DIR_ENV)
    return Path(configured) if configured else database_path.parent / "backups"


def list_backups(directory: Path) -> list[BackupFile]:
    if not directory.is_dir():
        return []
    found = []
    for path in directory.iterdir():
        taken_at = backup_time(path)
        if taken_at is not None and path.is_file():
            found.append(BackupFile(path=path, taken_at=taken_at, size_bytes=path.stat().st_size))
    return sorted(found, key=lambda backup: backup.taken_at)


def newest_backup_time(directory: Path) -> float | None:
    backups = list_backups(directory)
    return backups[-1].taken_at if backups else None


def backup_is_due(directory: Path, now: float, interval_seconds: float) -> bool:
    newest = newest_backup_time(directory)
    if newest is None:
        return True
    # a clock that jumped backwards must not suppress backups
    return newest > now or now - newest >= interval_seconds


def run_backup(
    source: Database | Path,
    destination_dir: Path,
    now: Callable[[], float] = time.time,
    retained: int = DEFAULT_RETAINED_BACKUPS,
) -> Path:
    if retained < 1:
        raise ValueError("retained must be at least 1, or the new backup is pruned too")
    if isinstance(source, Path) and not source.is_file():
        raise BackupError(f"{source} does not exist")
    destination_dir.mkdir(parents=True, exist_ok=True)
    with _exclusive(destination_dir):
        remove_partial_backups(destination_dir)
        target = destination_dir / backup_filename(now())
        partial = target.with_name(target.name + _PARTIAL_SUFFIX)
        try:
            _write_snapshot(source, partial)
            problems = database_problems(partial)
            if problems:
                raise BackupError("; ".join(problems))
            fsync_file(partial)
            os.replace(partial, target)
            fsync_directory(destination_dir)
        except BaseException:
            partial.unlink(missing_ok=True)
            raise
        prune_backups(destination_dir, retained)
    return target


@contextmanager
def _exclusive(directory: Path):
    # a scheduled run and a manual one must not share partials
    with open(directory / _DIRECTORY_LOCK, "ab") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _write_snapshot(source: Database | Path, destination: Path) -> None:
    if isinstance(source, Database):
        source.backup_to(destination)
        return
    target = sqlite3.connect(str(destination))
    try:
        copy_database(source, target)
        target.execute("PRAGMA journal_mode=DELETE")
    finally:
        target.close()


def remove_partial_backups(directory: Path) -> None:
    for path in directory.glob(f"verdict-*.db{_PARTIAL_SUFFIX}"):
        path.unlink(missing_ok=True)


def prune_backups(destination_dir: Path, retained: int) -> list[Path]:
    if retained < 1:
        raise ValueError("retained must be at least 1")
    stale = [backup.path for backup in list_backups(destination_dir)[:-retained]]
    for path in stale:
        path.unlink(missing_ok=True)
    return stale
