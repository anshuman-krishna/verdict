import os
import sqlite3
from pathlib import Path

REQUIRED_TABLES = frozenset({"contribution_edges", "flagged_hashes"})


def read_only_uri(path: Path) -> str:
    return f"{path.resolve().as_uri()}?mode=ro"


def database_problems(path: Path) -> list[str]:
    if not path.is_file():
        return [f"{path} does not exist"]
    try:
        connection = sqlite3.connect(read_only_uri(path), uri=True)
    except sqlite3.Error as error:
        return [f"{path} cannot be opened: {error}"]
    try:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master")}
        verdict = [row[0] for row in connection.execute("PRAGMA integrity_check")]
    except sqlite3.DatabaseError as error:
        return [f"{path} is not a readable database: {error}"]
    finally:
        connection.close()

    problems = []
    if verdict != ["ok"]:
        problems.append(f"{path} failed its integrity check: {'; '.join(verdict[:3])}")
    missing = REQUIRED_TABLES - tables
    if missing:
        problems.append(f"{path} is missing tables: {', '.join(sorted(missing))}")
    return problems


def fsync_file(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def fsync_directory(path: Path) -> None:
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)
