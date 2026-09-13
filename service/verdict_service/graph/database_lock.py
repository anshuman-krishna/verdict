import fcntl
from pathlib import Path
from typing import IO


class DatabaseInUseError(RuntimeError):
    pass


def lock_path(database_path: Path) -> Path:
    return database_path.with_name(database_path.name + ".lock")


class DatabaseLock:
    def __init__(self, database_path: Path) -> None:
        self._path = lock_path(database_path)
        self._handle: IO[bytes] | None = None

    def acquire(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(self._path, "ab")
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            handle.close()
            raise DatabaseInUseError(
                f"another process already has {self._path.with_suffix('')} open"
            ) from error
        self._handle = handle

    def release(self) -> None:
        if self._handle is None:
            return
        fcntl.flock(self._handle, fcntl.LOCK_UN)
        self._handle.close()
        self._handle = None

    def __enter__(self) -> "DatabaseLock":
        self.acquire()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.release()


def database_in_use(database_path: Path) -> bool:
    lock = DatabaseLock(database_path)
    try:
        lock.acquire()
    except DatabaseInUseError:
        return True
    lock.release()
    return False
