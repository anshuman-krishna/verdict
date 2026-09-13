import argparse
import sys
from pathlib import Path

from verdict_service.graph.restore import RestoreError, latest_backup, restore_database


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="restore-backup", description="restore the reviewer graph database from a backup"
    )
    parser.add_argument("database", help="path to write the restored database to")
    parser.add_argument("--backup", help="a specific backup file; defaults to the newest one")
    parser.add_argument(
        "--backup-dir", help="where backups are kept, defaults to backups/ next to the database"
    )
    parser.add_argument("--force", action="store_true", help="overwrite an existing database file")
    args = parser.parse_args(argv)

    database_path = Path(args.database)
    try:
        if args.backup:
            backup_path = Path(args.backup)
        else:
            backup_dir = (
                Path(args.backup_dir) if args.backup_dir else database_path.parent / "backups"
            )
            backup_path = latest_backup(backup_dir)
        restore_database(backup_path, database_path, force=args.force)
    except RestoreError as error:
        print(error, file=sys.stderr)
        return 1

    print(f"restored {database_path} from {backup_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
