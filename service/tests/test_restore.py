import sqlite3

import pytest

from verdict_service.graph.backup import run_backup
from verdict_service.graph.restore import RestoreError, latest_backup, restore_database
from verdict_service.graph.sqlite_store import SqliteFlaggedHashStore, connect


def test_restore_database_recovers_what_the_backup_held(tmp_path):
    database = connect(tmp_path / "verdict.db")
    SqliteFlaggedHashStore(database).add("abcd1111")
    backup = run_backup(database, tmp_path / "backups", now=lambda: 1.0)

    destination = tmp_path / "restored.db"
    restore_database(backup, destination)

    assert SqliteFlaggedHashStore(connect(destination)).matches("abcd") == ["abcd1111"]


def test_restore_refuses_to_overwrite_an_existing_file_without_force(tmp_path):
    database = connect(tmp_path / "verdict.db")
    backup = run_backup(database, tmp_path / "backups", now=lambda: 1.0)
    destination = tmp_path / "verdict.db"

    with pytest.raises(RestoreError, match="already exists"):
        restore_database(backup, destination)


def test_restore_overwrites_when_forced(tmp_path):
    database = connect(tmp_path / "source.db")
    SqliteFlaggedHashStore(database).add("abcd1111")
    backup = run_backup(database, tmp_path / "backups", now=lambda: 1.0)

    destination = tmp_path / "verdict.db"
    destination.write_bytes(b"an older database this restore replaces")
    restore_database(backup, destination, force=True)

    assert SqliteFlaggedHashStore(connect(destination)).matches("abcd") == ["abcd1111"]


def test_restore_refuses_a_backup_that_does_not_exist(tmp_path):
    with pytest.raises(RestoreError, match="not found"):
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


def test_restore_leaves_no_stale_wal_or_shm_files_behind(tmp_path):
    database = connect(tmp_path / "source.db")
    backup = run_backup(database, tmp_path / "backups", now=lambda: 1.0)
    destination = tmp_path / "verdict.db"
    destination.write_bytes(b"an older database this restore replaces")
    (tmp_path / "verdict.db-wal").write_bytes(b"stale")
    (tmp_path / "verdict.db-shm").write_bytes(b"stale")

    restore_database(backup, destination, force=True)

    assert not (tmp_path / "verdict.db-wal").exists()
    assert not (tmp_path / "verdict.db-shm").exists()


class TestLatestBackup:
    def test_picks_the_most_recently_named_file(self, tmp_path):
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
