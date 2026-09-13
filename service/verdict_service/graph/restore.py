import os
import shutil
import sqlite3
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from verdict_service.graph.backup import list_backups
from verdict_service.graph.database_lock import database_in_use
from verdict_service.graph.integrity import database_problems, fsync_directory, fsync_file

_SIDECAR_SUFFIXES = ("-wal", "-shm", "-journal")


class RestoreError(Exception):
    pass


@dataclass(frozen=True)
class RestoreResult:
    restored_from: Path
    database_path: Path
    set_aside: list[Path]


def latest_backup(backup_dir: Path) -> Path:
    backups = list_backups(backup_dir)
    if not backups:
        raise RestoreError(f"no backups found in {backup_dir}")
    return backups[-1].path


def verify_backup(backup_path: Path) -> None:
    problems = database_problems(backup_path)
    if problems:
        raise RestoreError("; ".join(problems))


def _sidecars(database_path: Path) -> list[Path]:
    return [database_path.with_name(database_path.name + suffix) for suffix in _SIDECAR_SUFFIXES]


def restore_database(
    backup_path: Path,
    database_path: Path,
    force: bool = False,
    now: Callable[[], float] = time.time,
) -> RestoreResult:
    verify_backup(backup_path)
    if database_path.is_dir():
        raise RestoreError(f"{database_path} is a directory")
    if backup_path.resolve() == database_path.resolve():
        raise RestoreError("the backup and the database are the same file")
    if database_path.exists() and not force:
        raise RestoreError(
            f"{database_path} already exists, restore with --force to replace it "
            "(the old file is kept)"
        )
    if database_in_use(database_path):
        raise RestoreError(f"{database_path} is open in a running service, stop it first")

    database_path.parent.mkdir(parents=True, exist_ok=True)
    staged = database_path.with_name(database_path.name + ".restoring")
    try:
        shutil.copyfile(backup_path, staged)
        _make_self_contained(staged)
        problems = database_problems(staged)
        if problems:
            raise RestoreError("the copied backup did not verify: " + "; ".join(problems))
        fsync_file(staged)
        set_aside = _set_aside(database_path, now())
        os.replace(staged, database_path)
        fsync_directory(database_path.parent)
    finally:
        for leftover in [staged, *_sidecars(staged)]:
            leftover.unlink(missing_ok=True)

    return RestoreResult(
        restored_from=backup_path, database_path=database_path, set_aside=set_aside
    )


def _make_self_contained(path: Path) -> None:
    connection = sqlite3.connect(str(path))
    try:
        connection.execute("PRAGMA journal_mode=DELETE")
    finally:
        connection.close()


def _set_aside(database_path: Path, now: float) -> list[Path]:
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(now))
    moved = []
    for path in [database_path, *_sidecars(database_path)]:
        if path.exists():
            destination = path.with_name(f"{path.name}.pre-restore-{stamp}")
            os.replace(path, destination)
            moved.append(destination)
    return moved
