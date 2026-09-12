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
