import pytest

from verdict_service.graph.backup import BACKUP_DIR_ENV, list_backups, run_backup
from verdict_service.graph.backup_cli import main
from verdict_service.graph.database_lock import DatabaseLock
from verdict_service.graph.sqlite_store import SqliteFlaggedHashStore, connect


@pytest.fixture(autouse=True)
def no_configured_backup_dir(monkeypatch):
    monkeypatch.delenv(BACKUP_DIR_ENV, raising=False)


def seeded(tmp_path, name="source.db"):
    database = connect(tmp_path / name)
    SqliteFlaggedHashStore(database).add("abcd1111")
    return database


def test_restores_the_newest_backup_from_the_default_directory(tmp_path, capsys):
    run_backup(seeded(tmp_path), tmp_path / "backups", now=lambda: 1.0)

    assert main(["restore", str(tmp_path / "restored.db")]) == 0

    assert "restored" in capsys.readouterr().out
    assert SqliteFlaggedHashStore(connect(tmp_path / "restored.db")).matches("abcd") == ["abcd1111"]


def test_a_missing_backup_directory_reports_an_error_not_a_traceback(tmp_path, capsys):
    assert main(["restore", str(tmp_path / "restored.db")]) == 1
    assert "no backups" in capsys.readouterr().err


def test_refuses_to_clobber_an_existing_database_without_force(tmp_path, capsys):
    run_backup(seeded(tmp_path), tmp_path / "backups", now=lambda: 1.0)
    (tmp_path / "verdict.db").write_bytes(b"live")

    assert main(["restore", str(tmp_path / "verdict.db")]) == 1
    assert "already exists" in capsys.readouterr().err


def test_force_replaces_and_reports_what_it_kept(tmp_path, capsys):
    run_backup(seeded(tmp_path), tmp_path / "backups", now=lambda: 1.0)
    (tmp_path / "verdict.db").write_bytes(b"live")

    assert main(["restore", str(tmp_path / "verdict.db"), "--force"]) == 0
    assert "kept the previous file" in capsys.readouterr().out


def test_refuses_to_restore_under_a_running_service(tmp_path, capsys):
    run_backup(seeded(tmp_path), tmp_path / "backups", now=lambda: 1.0)
    (tmp_path / "verdict.db").write_bytes(b"live")

    with DatabaseLock(tmp_path / "verdict.db"):
        assert main(["restore", str(tmp_path / "verdict.db"), "--force"]) == 1
    assert "stop it first" in capsys.readouterr().err


def test_a_specific_backup_overrides_the_default_directory(tmp_path):
    database = seeded(tmp_path)
    chosen = run_backup(database, tmp_path / "backups", now=lambda: 1.0)
    SqliteFlaggedHashStore(database).add("efgh2222")
    run_backup(database, tmp_path / "backups", now=lambda: 2.0)

    assert main(["restore", str(tmp_path / "restored.db"), "--backup", str(chosen)]) == 0
    assert SqliteFlaggedHashStore(connect(tmp_path / "restored.db")).matches("efgh") == []


def test_create_takes_a_backup_of_a_live_database(tmp_path, capsys):
    seeded(tmp_path, "verdict.db")

    assert main(["create", str(tmp_path / "verdict.db")], now=lambda: 1_000.0) == 0

    assert "wrote" in capsys.readouterr().out
    assert len(list_backups(tmp_path / "backups")) == 1


def test_create_honours_the_configured_backup_directory(tmp_path, monkeypatch):
    seeded(tmp_path, "verdict.db")
    monkeypatch.setenv(BACKUP_DIR_ENV, str(tmp_path / "offsite"))

    assert main(["create", str(tmp_path / "verdict.db")], now=lambda: 1_000.0) == 0
    assert len(list_backups(tmp_path / "offsite")) == 1


def test_create_rejects_a_zero_retention(tmp_path, capsys):
    seeded(tmp_path, "verdict.db")
    assert main(["create", str(tmp_path / "verdict.db"), "--retained", "0"]) == 1
    assert "retained" in capsys.readouterr().err


def test_list_shows_backups_with_their_age(tmp_path, capsys):
    database = seeded(tmp_path, "verdict.db")
    run_backup(database, tmp_path / "backups", now=lambda: 0.0)

    assert main(["list", str(tmp_path / "verdict.db")], now=lambda: 7200.0) == 0
    assert "2.0h old" in capsys.readouterr().out


def test_list_fails_when_there_is_nothing_to_restore(tmp_path, capsys):
    assert main(["list", str(tmp_path / "verdict.db")]) == 1
    assert "no backups" in capsys.readouterr().out


def test_verify_checks_the_newest_backup(tmp_path, capsys):
    run_backup(seeded(tmp_path), tmp_path / "backups", now=lambda: 1.0)
    assert main(["verify", str(tmp_path / "verdict.db")]) == 0
    assert capsys.readouterr().out.startswith("ok ")


def test_verify_fails_on_a_corrupt_backup(tmp_path, capsys):
    bad = tmp_path / "bad.db"
    bad.write_bytes(b"not a database")
    assert main(["verify", str(tmp_path / "verdict.db"), "--backup", str(bad)]) == 1
    assert "not a readable database" in capsys.readouterr().err
