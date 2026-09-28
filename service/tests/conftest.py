import sqlite3

import pytest

from verdict_service.graph.backup import run_backup
from verdict_service.graph.sqlite_store import SqliteFlaggedHashStore, connect


@pytest.fixture
def backup_out_of_step_with_its_index(tmp_path):
    # opens, lists every table and reads rows, so only the integrity check can tell
    database = connect(tmp_path / "source.db")
    SqliteFlaggedHashStore(database).add_many([f"{index:064x}" for index in range(50)])
    backup = run_backup(database, tmp_path / "backups", now=lambda: 1.0)
    connection = sqlite3.connect(backup)
    connection.execute("CREATE INDEX by_hash ON flagged_hashes(full_hash)")
    connection.execute("PRAGMA writable_schema=ON")
    connection.execute(
        "UPDATE sqlite_master SET sql = 'CREATE INDEX by_hash ON flagged_hashes(full_hash DESC)'"
        " WHERE name = 'by_hash'"
    )
    connection.commit()
    connection.close()
    return backup
