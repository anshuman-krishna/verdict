from verdict_service.health import HealthTracker


def clock(at: float = 1000.0):
    return lambda: at


class TestHealthTracker:
    def test_starts_with_no_recorded_attempt(self):
        assert HealthTracker().last is None

    def test_records_a_successful_recompute(self):
        tracker = HealthTracker()
        tracker.record_success(3, now=clock(1000.0))
        assert tracker.last.completed_at == 1000.0
        assert tracker.last.flagged_count == 3
        assert tracker.last.error is None

    def test_records_a_failed_recompute(self):
        tracker = HealthTracker()
        tracker.record_failure(RuntimeError("db locked"), now=clock(1000.0))
        assert tracker.last.completed_at == 1000.0
        assert tracker.last.flagged_count is None
        assert tracker.last.error == "db locked"

    def test_a_later_attempt_replaces_the_previous_one(self):
        tracker = HealthTracker()
        tracker.record_failure(RuntimeError("db locked"), now=clock(1000.0))
        tracker.record_success(5, now=clock(2000.0))
        assert tracker.last.completed_at == 2000.0
        assert tracker.last.error is None

    def test_starts_with_no_recorded_backup(self):
        assert HealthTracker().last_backup is None

    def test_records_a_successful_backup(self):
        tracker = HealthTracker()
        tracker.record_backup_success("/data/backups/verdict-1.db", now=clock(1000.0))
        assert tracker.last_backup.completed_at == 1000.0
        assert tracker.last_backup.path == "/data/backups/verdict-1.db"
        assert tracker.last_backup.error is None

    def test_records_a_failed_backup(self):
        tracker = HealthTracker()
        tracker.record_backup_failure(RuntimeError("disk full"), now=clock(1000.0))
        assert tracker.last_backup.completed_at == 1000.0
        assert tracker.last_backup.path is None
        assert tracker.last_backup.error == "disk full"

    def test_a_later_backup_replaces_the_previous_one(self):
        tracker = HealthTracker()
        tracker.record_backup_failure(RuntimeError("disk full"), now=clock(1000.0))
        tracker.record_backup_success("/data/backups/verdict-2.db", now=clock(2000.0))
        assert tracker.last_backup.completed_at == 2000.0
        assert tracker.last_backup.error is None

    def test_recompute_and_backup_attempts_are_tracked_independently(self):
        tracker = HealthTracker()
        tracker.record_success(5, now=clock(1000.0))
        tracker.record_backup_failure(RuntimeError("disk full"), now=clock(2000.0))
        assert tracker.last.completed_at == 1000.0
        assert tracker.last.error is None
        assert tracker.last_backup.completed_at == 2000.0
        assert tracker.last_backup.error == "disk full"
