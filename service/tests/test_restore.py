import sqlite3

import pytest

from verdict_service.graph import restore as restore_module
from verdict_service.graph.backup import run_backup
from verdict_service.graph.database_lock import DatabaseLock
from verdict_service.graph.restore import (
    RestoreError,
    latest_backup,
    restore_database,
    verify_backup,
)
from verdict_service.graph.sqlite_store import SqliteFlaggedHashStore, connect


def backup_holding(tmp_path, *hashes: str):
    database = connect(tmp_path / "source.db")
    for full_hash in hashes:
        SqliteFlaggedHashStore(database).add(full_hash)
    return run_backup(database, tmp_path / "backups", now=lambda: 1.0)


def test_restore_database_recovers_what_the_backup_held(tmp_path):
    backup = backup_holding(tmp_path, "abcd1111")
    destination = tmp_path / "restored.db"

    result = restore_database(backup, destination)

    assert result.set_aside == []
    assert SqliteFlaggedHashStore(connect(destination)).matches("abcd") == ["abcd1111"]


def test_restore_refuses_to_overwrite_an_existing_file_without_force(tmp_path):
    backup = backup_holding(tmp_path)
    destination = tmp_path / "verdict.db"
    destination.write_bytes(b"live")

    with pytest.raises(RestoreError, match="already exists"):
        restore_database(backup, destination)
    assert destination.read_bytes() == b"live"


def test_a_forced_restore_keeps_the_replaced_database_and_its_wal(tmp_path):
    backup = backup_holding(tmp_path, "abcd1111")
    destination = tmp_path / "verdict.db"
    destination.write_bytes(b"an older database this restore replaces")
    (tmp_path / "verdict.db-wal").write_bytes(b"uncheckpointed pages")
    (tmp_path / "verdict.db-shm").write_bytes(b"index")

    result = restore_database(backup, destination, force=True, now=lambda: 0.0)

    assert not (tmp_path / "verdict.db-wal").exists()
    assert not (tmp_path / "verdict.db-shm").exists()
    kept = {path.name: path.read_bytes() for path in result.set_aside}
    assert kept == {
        "verdict.db.pre-restore-19700101T000000Z": b"an older database this restore replaces",
        "verdict.db-wal.pre-restore-19700101T000000Z": b"uncheckpointed pages",
        "verdict.db-shm.pre-restore-19700101T000000Z": b"index",
    }
    assert SqliteFlaggedHashStore(connect(destination)).matches("abcd") == ["abcd1111"]


def test_restore_refuses_a_backup_that_does_not_exist(tmp_path):
    with pytest.raises(RestoreError, match="does not exist"):
        restore_database(tmp_path / "missing.db", tmp_path / "verdict.db")


def test_restore_refuses_a_file_that_is_not_a_database(tmp_path):
    fake = tmp_path / "verdict-20260101T000000Z.db"
    fake.write_bytes(b"this is not a database")

    with pytest.raises(RestoreError, match="not a readable database"):
        restore_database(fake, tmp_path / "verdict.db")


def test_restore_refuses_a_database_missing_the_expected_tables(tmp_path):
    empty = tmp_path / "verdict-20260101T000000Z.db"
    sqlite3.connect(empty).close()

    with pytest.raises(RestoreError, match="missing tables"):
        restore_database(empty, tmp_path / "verdict.db")


def test_restore_refuses_a_truncated_backup_whose_tables_still_list(tmp_path):
    database = connect(tmp_path / "source.db")
    SqliteFlaggedHashStore(database).add_many([f"{index:064x}" for index in range(5000)])
    backup = run_backup(database, tmp_path / "backups", now=lambda: 1.0)
    data = backup.read_bytes()
    backup.write_bytes(data[: len(data) // 2])

    with pytest.raises(RestoreError):
        restore_database(backup, tmp_path / "verdict.db")
    assert not (tmp_path / "verdict.db").exists()


def test_restore_refuses_while_a_running_service_holds_the_database(tmp_path):
    backup = backup_holding(tmp_path)
    destination = tmp_path / "verdict.db"
    destination.write_bytes(b"live")

    with DatabaseLock(destination):
        with pytest.raises(RestoreError, match="stop it first"):
            restore_database(backup, destination, force=True)
    assert destination.read_bytes() == b"live"


def test_restore_refuses_to_copy_a_file_onto_itself(tmp_path):
    backup = backup_holding(tmp_path)
    with pytest.raises(RestoreError, match="same file"):
        restore_database(backup, backup, force=True)


def test_a_failure_after_staging_leaves_the_live_database_untouched(tmp_path, monkeypatch):
    backup = backup_holding(tmp_path)
    destination = tmp_path / "verdict.db"
    destination.write_bytes(b"live")

    def broken_fsync(_path):
        raise OSError("disk full")

    monkeypatch.setattr(restore_module, "fsync_file", broken_fsync)
    with pytest.raises(OSError):
        restore_database(backup, destination, force=True)

    assert destination.read_bytes() == b"live"
    assert sorted(path.name for path in tmp_path.iterdir() if path.is_file()) == [
        "source.db",
        "source.db-shm",
        "source.db-wal",
        "verdict.db",
        "verdict.db.lock",
    ]


def test_verify_backup_accepts_a_good_backup_and_names_a_bad_one(tmp_path):
    verify_backup(backup_holding(tmp_path))
    bad = tmp_path / "bad.db"
    bad.write_bytes(b"nope")
    with pytest.raises(RestoreError, match="bad.db"):
        verify_backup(bad)


def test_a_path_with_uri_characters_is_validated_as_that_file(tmp_path):
    odd = tmp_path / "odd?mode=rwc#dir"
    odd.mkdir()
    backup = backup_holding(odd, "abcd1111")
    verify_backup(backup)
    restore_database(backup, tmp_path / "verdict.db")


class TestLatestBackup:
    def test_picks_the_most_recent_backup(self, tmp_path):
        database = connect(tmp_path / "verdict.db")
        run_backup(database, tmp_path / "backups", now=lambda: 1_000.0)
        newest = run_backup(database, tmp_path / "backups", now=lambda: 2_000.0)

        assert latest_backup(tmp_path / "backups") == newest

    def test_raises_when_the_directory_has_no_backups(self, tmp_path):
        (tmp_path / "backups").mkdir()
        with pytest.raises(RestoreError, match="no backups"):
            latest_backup(tmp_path / "backups")

    def test_raises_when_the_directory_does_not_exist(self, tmp_path):
        with pytest.raises(RestoreError, match="no backups"):
            latest_backup(tmp_path / "backups")
