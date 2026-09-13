import sqlite3

from verdict_service.graph.backup import backup_filename, prune_backups, run_backup
from verdict_service.graph.sqlite_store import SqliteFlaggedHashStore, connect


def test_run_backup_writes_a_file_readable_on_its_own(tmp_path):
    database = connect(tmp_path / "verdict.db")
    SqliteFlaggedHashStore(database).add("abcd1111")

    target = run_backup(database, tmp_path / "backups", now=lambda: 1_700_000_000.0)

    assert target.exists()
    raw = sqlite3.connect(target)
    assert raw.execute("SELECT full_hash FROM flagged_hashes").fetchall() == [("abcd1111",)]


def test_run_backup_names_the_file_from_the_given_time(tmp_path):
    database = connect(tmp_path / "verdict.db")
    target = run_backup(database, tmp_path / "backups", now=lambda: 1_700_000_000.0)
    assert target.name == backup_filename(1_700_000_000.0)


def test_run_backup_creates_the_destination_directory(tmp_path):
    database = connect(tmp_path / "verdict.db")
    destination = tmp_path / "nested" / "backups"
    run_backup(database, destination, now=lambda: 1.0)
    assert destination.is_dir()


def test_run_backup_keeps_only_the_most_recent_ones(tmp_path):
    database = connect(tmp_path / "verdict.db")
    destination = tmp_path / "backups"
    times = [1_000.0, 2_000.0, 3_000.0, 4_000.0]
    for moment in times:
        run_backup(database, destination, now=lambda moment=moment: moment, retained=2)

    remaining = sorted(path.name for path in destination.glob("verdict-*.db"))
    assert remaining == [backup_filename(3_000.0), backup_filename(4_000.0)]


def test_a_negative_or_zero_retained_count_prunes_everything(tmp_path):
    database = connect(tmp_path / "verdict.db")
    destination = tmp_path / "backups"
    run_backup(database, destination, now=lambda: 1_000.0, retained=1)
    prune_backups(destination, retained=0)
    assert list(destination.glob("verdict-*.db")) == []


def test_a_backup_reflects_only_what_was_committed_before_it_ran(tmp_path):
    database = connect(tmp_path / "verdict.db")
    SqliteFlaggedHashStore(database).add("abcd1111")
    target = run_backup(database, tmp_path / "backups", now=lambda: 1.0)
    SqliteFlaggedHashStore(database).add("efgh2222")

    raw = sqlite3.connect(target)
    assert raw.execute("SELECT full_hash FROM flagged_hashes").fetchall() == [("abcd1111",)]
