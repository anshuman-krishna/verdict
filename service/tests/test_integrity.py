import sqlite3

from verdict_service.graph.integrity import database_problems
from verdict_service.graph.sqlite_store import connect


def test_a_healthy_store_has_no_problems(tmp_path):
    connect(tmp_path / "verdict.db")
    assert database_problems(tmp_path / "verdict.db") == []


def test_a_missing_file_is_a_problem(tmp_path):
    assert database_problems(tmp_path / "absent.db") == [f"{tmp_path / 'absent.db'} does not exist"]


def test_a_directory_is_not_a_database(tmp_path):
    assert database_problems(tmp_path) != []


def test_checking_never_creates_or_modifies_the_file(tmp_path):
    path = tmp_path / "plain.db"
    sqlite3.connect(path).close()
    before = path.read_bytes()
    database_problems(path)
    assert path.read_bytes() == before
    assert sorted(entry.name for entry in tmp_path.iterdir()) == ["plain.db"]


def test_corrupted_pages_fail_the_integrity_check(tmp_path):
    path = tmp_path / "verdict.db"
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA page_size=1024")
    connection.executescript(
        "CREATE TABLE contribution_edges (id INTEGER PRIMARY KEY, body TEXT);"
        "CREATE TABLE flagged_hashes (full_hash TEXT PRIMARY KEY);"
    )
    connection.executemany(
        "INSERT INTO flagged_hashes VALUES (?)", [(f"{index:064x}",) for index in range(3000)]
    )
    connection.commit()
    connection.close()

    data = bytearray(path.read_bytes())
    for offset in range(4 * 1024, 6 * 1024):
        data[offset] = 0xFF
    path.write_bytes(bytes(data))

    assert database_problems(path) != []
