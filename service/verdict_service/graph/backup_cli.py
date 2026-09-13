import argparse
import sqlite3
import sys
import time
from collections.abc import Callable
from pathlib import Path

from verdict_service.graph.backup import (
    DEFAULT_RETAINED_BACKUPS,
    BackupError,
    default_backup_dir,
    list_backups,
    run_backup,
)
from verdict_service.graph.restore import (
    RestoreError,
    latest_backup,
    restore_database,
    verify_backup,
)


def _backup_dir(args: argparse.Namespace) -> Path:
    return Path(args.backup_dir) if args.backup_dir else default_backup_dir(Path(args.database))


def _chosen_backup(args: argparse.Namespace) -> Path:
    return Path(args.backup) if args.backup else latest_backup(_backup_dir(args))


def _list(args: argparse.Namespace, now: Callable[[], float]) -> int:
    backups = list_backups(_backup_dir(args))
    if not backups:
        print(f"no backups in {_backup_dir(args)}")
        return 1
    for backup in backups:
        age_hours = (now() - backup.taken_at) / 3600
        taken = time.strftime("%Y-%m-%d %H:%M:%SZ", time.gmtime(backup.taken_at))
        print(f"{backup.path}\t{taken}\t{backup.size_bytes} bytes\t{age_hours:.1f}h old")
    return 0


def _verify(args: argparse.Namespace, _now: Callable[[], float]) -> int:
    backup = _chosen_backup(args)
    verify_backup(backup)
    print(f"ok {backup}")
    return 0


def _create(args: argparse.Namespace, now: Callable[[], float]) -> int:
    target = run_backup(Path(args.database), _backup_dir(args), now=now, retained=args.retained)
    print(f"wrote {target}")
    return 0


def _restore(args: argparse.Namespace, now: Callable[[], float]) -> int:
    result = restore_database(_chosen_backup(args), Path(args.database), force=args.force, now=now)
    print(f"restored {result.database_path} from {result.restored_from}")
    for path in result.set_aside:
        print(f"kept the previous file as {path}")
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="backups", description="reviewer graph backups")
    commands = parser.add_subparsers(dest="command", required=True)

    def add(name: str, help_text: str) -> argparse.ArgumentParser:
        command = commands.add_parser(name, help=help_text)
        command.add_argument("database", help="path of the live database file")
        command.add_argument("--backup-dir", help="defaults to VERDICT_BACKUP_DIR or ./backups")
        return command

    add("list", "show every backup, oldest first")
    add("verify", "integrity check a backup").add_argument("--backup")
    create = add("create", "take a backup now, safe while the service runs")
    create.add_argument("--retained", type=int, default=DEFAULT_RETAINED_BACKUPS)
    restore = add("restore", "replace the database with a backup, service stopped")
    restore.add_argument("--backup", help="a specific backup, defaults to the newest")
    restore.add_argument("--force", action="store_true", help="replace an existing database")
    return parser


_COMMANDS = {"list": _list, "verify": _verify, "create": _create, "restore": _restore}


def main(argv: list[str] | None = None, now: Callable[[], float] = time.time) -> int:
    args = _parser().parse_args(argv)
    try:
        return _COMMANDS[args.command](args, now)
    except (BackupError, RestoreError, ValueError, OSError, sqlite3.Error) as error:
        print(error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
