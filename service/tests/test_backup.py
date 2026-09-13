import sqlite3

import pytest

from verdict_service.graph import backup as backup_module
from verdict_service.graph.backup import (
    BACKUP_DIR_ENV,
    BackupError,
    backup_filename,
    backup_is_due,
    backup_time,
    default_backup_dir,
    list_backups,
    newest_backup_time,
    prune_backups,
    run_backup,
)
from verdict_service.graph.sqlite_store import SqliteFlaggedHashStore, connect

DAY = 24 * 60 * 60


def test_run_backup_writes_a_file_readable_on_its_own(tmp_path):
    database = connect(tmp_path / "verdict.db")
    SqliteFlaggedHashStore(database).add("abcd1111")

    target = run_backup(database, tmp_path / "backups", now=lambda: 1_700_000_000.0)

    raw = sqlite3.connect(target)
    assert raw.execute("SELECT full_hash FROM flagged_hashes").fetchall() == [("abcd1111",)]


def test_a_backup_is_a_single_self_contained_file(tmp_path):
    database = connect(tmp_path / "verdict.db")
    target = run_backup(database, tmp_path / "backups", now=lambda: 1.0)

    raw = sqlite3.connect(target)
    assert raw.execute("PRAGMA journal_mode").fetchone() == ("delete",)
    raw.close()
    written = sorted(path.name for path in (tmp_path / "backups").iterdir())
    assert written == [".backup.lock", target.name]


def test_run_backup_names_the_file_from_the_given_time(tmp_path):
    database = connect(tmp_path / "verdict.db")
    target = run_backup(database, tmp_path / "backups", now=lambda: 1_700_000_000.0)
    assert target.name == backup_filename(1_700_000_000.0)
    assert backup_time(target) == 1_700_000_000.0


def test_run_backup_creates_the_destination_directory(tmp_path):
    database = connect(tmp_path / "verdict.db")
    destination = tmp_path / "nested" / "backups"
    run_backup(database, destination, now=lambda: 1.0)
    assert destination.is_dir()


def test_run_backup_keeps_only_the_most_recent_ones(tmp_path):
    database = connect(tmp_path / "verdict.db")
    destination = tmp_path / "backups"
    for moment in [1_000.0, 2_000.0, 3_000.0, 4_000.0]:
        run_backup(database, destination, now=lambda moment=moment: moment, retained=2)

    remaining = [backup.path.name for backup in list_backups(destination)]
    assert remaining == [backup_filename(3_000.0), backup_filename(4_000.0)]


@pytest.mark.parametrize("retained", [0, -1])
def test_a_retained_count_that_would_delete_the_new_backup_is_refused(tmp_path, retained):
    database = connect(tmp_path / "verdict.db")
    with pytest.raises(ValueError):
        run_backup(database, tmp_path / "backups", now=lambda: 1.0, retained=retained)
    with pytest.raises(ValueError):
        prune_backups(tmp_path / "backups", retained)


def test_pruning_never_touches_files_it_did_not_write(tmp_path):
    database = connect(tmp_path / "verdict.db")
    destination = tmp_path / "backups"
    destination.mkdir()
    manual = destination / "verdict-before-migration.db"
    manual.write_bytes(b"kept by an operator")
    for moment in [1_000.0, 2_000.0, 3_000.0]:
        run_backup(database, destination, now=lambda moment=moment: moment, retained=1)

    assert manual.exists()
    assert [backup.path.name for backup in list_backups(destination)] == [backup_filename(3_000.0)]


def test_an_operator_file_is_never_mistaken_for_the_newest_backup(tmp_path):
    database = connect(tmp_path / "verdict.db")
    destination = tmp_path / "backups"
    newest = run_backup(database, destination, now=lambda: 1_000.0)
    (destination / "verdict-zzz.db").write_bytes(b"not a backup")
    assert list_backups(destination)[-1].path == newest


def test_a_backup_reflects_only_what_was_committed_before_it_ran(tmp_path):
    database = connect(tmp_path / "verdict.db")
    SqliteFlaggedHashStore(database).add("abcd1111")
    target = run_backup(database, tmp_path / "backups", now=lambda: 1.0)
    SqliteFlaggedHashStore(database).add("efgh2222")

    raw = sqlite3.connect(target)
    assert raw.execute("SELECT full_hash FROM flagged_hashes").fetchall() == [("abcd1111",)]


def test_a_failed_snapshot_leaves_no_partial_file_to_be_mistaken_for_a_backup(
    tmp_path, monkeypatch
):
    database = connect(tmp_path / "verdict.db")
    destination = tmp_path / "backups"
    good = run_backup(database, destination, now=lambda: 1_000.0, retained=1)

    def torn_write(_source, partial):
        partial.write_bytes(b"half a database")
        raise OSError("disk full")

    monkeypatch.setattr(backup_module, "_write_snapshot", torn_write)
    with pytest.raises(OSError, match="disk full"):
        run_backup(database, destination, now=lambda: 2_000.0, retained=1)

    assert sorted(path.name for path in destination.iterdir()) == [".backup.lock", good.name]


def test_a_snapshot_that_fails_its_integrity_check_is_not_promoted(tmp_path, monkeypatch):
    database = connect(tmp_path / "verdict.db")
    destination = tmp_path / "backups"
    good = run_backup(database, destination, now=lambda: 1_000.0, retained=1)

    monkeypatch.setattr(
        backup_module, "_write_snapshot", lambda _source, partial: sqlite3.connect(partial).close()
    )
    with pytest.raises(BackupError, match="missing tables"):
        run_backup(database, destination, now=lambda: 2_000.0, retained=1)

    assert [backup.path for backup in list_backups(destination)] == [good]


def test_leftover_partial_files_from_a_killed_run_are_cleared(tmp_path):
    database = connect(tmp_path / "verdict.db")
    destination = tmp_path / "backups"
    destination.mkdir()
    (destination / "verdict-19700101T000001Z.db.partial").write_bytes(b"killed mid write")

    run_backup(database, destination, now=lambda: 5_000.0)

    assert not list(destination.glob("*.partial"))


def test_a_backup_can_be_taken_from_a_file_path_while_the_store_is_open(tmp_path):
    database = connect(tmp_path / "verdict.db")
    SqliteFlaggedHashStore(database).add("abcd1111")

    target = run_backup(tmp_path / "verdict.db", tmp_path / "backups", now=lambda: 1.0)

    assert SqliteFlaggedHashStore(connect(target)).matches("abcd") == ["abcd1111"]


def test_a_backup_of_a_missing_file_is_an_error(tmp_path):
    with pytest.raises(BackupError, match="does not exist"):
        run_backup(tmp_path / "absent.db", tmp_path / "backups", now=lambda: 1.0)
    assert not (tmp_path / "backups").exists()


class TestBackupIsDue:
    def test_due_when_there_are_no_backups(self, tmp_path):
        assert backup_is_due(tmp_path / "backups", now=10.0, interval_seconds=DAY)

    def test_not_due_within_the_interval(self, tmp_path):
        run_backup(connect(tmp_path / "verdict.db"), tmp_path / "backups", now=lambda: DAY)
        assert not backup_is_due(tmp_path / "backups", now=DAY + 3600, interval_seconds=DAY)

    def test_due_once_the_interval_has_passed(self, tmp_path):
        run_backup(connect(tmp_path / "verdict.db"), tmp_path / "backups", now=lambda: DAY)
        assert backup_is_due(tmp_path / "backups", now=2 * DAY, interval_seconds=DAY)

    def test_due_when_the_newest_backup_is_dated_in_the_future(self, tmp_path):
        run_backup(connect(tmp_path / "verdict.db"), tmp_path / "backups", now=lambda: 9 * DAY)
        assert backup_is_due(tmp_path / "backups", now=DAY, interval_seconds=DAY)

    def test_newest_backup_time_is_none_without_backups(self, tmp_path):
        assert newest_backup_time(tmp_path / "backups") is None


class TestDefaultBackupDir:
    def test_sits_beside_the_database(self, tmp_path, monkeypatch):
        monkeypatch.delenv(BACKUP_DIR_ENV, raising=False)
        assert default_backup_dir(tmp_path / "verdict.db") == tmp_path / "backups"

    def test_can_live_on_a_separate_volume(self, tmp_path, monkeypatch):
        monkeypatch.setenv(BACKUP_DIR_ENV, str(tmp_path / "elsewhere"))
        assert default_backup_dir(tmp_path / "verdict.db") == tmp_path / "elsewhere"


def test_concurrent_backups_in_the_same_second_do_not_corrupt_each_other(tmp_path):
    import threading

    database = connect(tmp_path / "verdict.db")
    SqliteFlaggedHashStore(database).add_many([f"{index:064x}" for index in range(20000)])
    errors = []

    def take():
        try:
            run_backup(database, tmp_path / "backups", now=lambda: 1_000.0)
        except Exception as error:
            errors.append(error)

    threads = [threading.Thread(target=take) for _ in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    [only] = list_backups(tmp_path / "backups")
    assert SqliteFlaggedHashStore(connect(only.path)).matches("0000") != []
