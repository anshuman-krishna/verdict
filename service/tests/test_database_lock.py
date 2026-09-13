import pytest

from verdict_service.graph.database_lock import (
    DatabaseInUseError,
    DatabaseLock,
    database_in_use,
)


def test_a_free_database_is_not_in_use(tmp_path):
    assert not database_in_use(tmp_path / "verdict.db")


def test_a_held_lock_marks_the_database_in_use(tmp_path):
    with DatabaseLock(tmp_path / "verdict.db"):
        assert database_in_use(tmp_path / "verdict.db")
    assert not database_in_use(tmp_path / "verdict.db")


def test_a_second_holder_is_refused(tmp_path):
    with DatabaseLock(tmp_path / "verdict.db"):
        with pytest.raises(DatabaseInUseError):
            DatabaseLock(tmp_path / "verdict.db").acquire()


def test_releasing_twice_is_harmless(tmp_path):
    lock = DatabaseLock(tmp_path / "verdict.db")
    lock.acquire()
    lock.release()
    lock.release()
    assert not database_in_use(tmp_path / "verdict.db")
