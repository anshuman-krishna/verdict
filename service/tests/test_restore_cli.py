from verdict_service.graph.backup import run_backup
from verdict_service.graph.restore_cli import main
from verdict_service.graph.sqlite_store import SqliteFlaggedHashStore, connect


def test_restores_the_newest_backup_from_the_default_directory(tmp_path, capsys):
    database = connect(tmp_path / "source.db")
    SqliteFlaggedHashStore(database).add("abcd1111")
    run_backup(database, tmp_path / "backups", now=lambda: 1.0)

    destination = tmp_path / "restored.db"
    code = main([str(destination), "--backup-dir", str(tmp_path / "backups")])

    assert code == 0
    assert SqliteFlaggedHashStore(connect(destination)).matches("abcd") == ["abcd1111"]
    assert "restored" in capsys.readouterr().out


def test_a_missing_backup_directory_reports_an_error_not_a_traceback(tmp_path, capsys):
    code = main([str(tmp_path / "restored.db"), "--backup-dir", str(tmp_path / "backups")])
    assert code == 1
    assert "no backups" in capsys.readouterr().err


def test_refuses_to_clobber_an_existing_database_without_force(tmp_path, capsys):
    database = connect(tmp_path / "source.db")
    run_backup(database, tmp_path / "backups", now=lambda: 1.0)
    destination = tmp_path / "restored.db"
    destination.write_bytes(b"already here")

    code = main([str(destination), "--backup-dir", str(tmp_path / "backups")])

    assert code == 1
    assert "already exists" in capsys.readouterr().err


def test_force_overwrites_an_existing_database(tmp_path):
    database = connect(tmp_path / "source.db")
    SqliteFlaggedHashStore(database).add("abcd1111")
    run_backup(database, tmp_path / "backups", now=lambda: 1.0)
    destination = tmp_path / "restored.db"
    destination.write_bytes(b"already here")

    code = main([str(destination), "--backup-dir", str(tmp_path / "backups"), "--force"])

    assert code == 0
    assert SqliteFlaggedHashStore(connect(destination)).matches("abcd") == ["abcd1111"]


def test_a_specific_backup_file_overrides_the_default_directory(tmp_path):
    database = connect(tmp_path / "source.db")
    SqliteFlaggedHashStore(database).add("abcd1111")
    chosen = run_backup(database, tmp_path / "backups", now=lambda: 1.0)
    SqliteFlaggedHashStore(database).add("efgh2222")
    run_backup(database, tmp_path / "backups", now=lambda: 2.0)

    destination = tmp_path / "restored.db"
    code = main([str(destination), "--backup", str(chosen)])

    assert code == 0
    assert SqliteFlaggedHashStore(connect(destination)).matches("") == ["abcd1111"]
