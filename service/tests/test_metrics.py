from verdict_service.metrics import MetricsRegistry


class TestMetricsRegistry:
    def test_starts_at_zero(self):
        rendered = MetricsRegistry().render_prometheus()
        assert "verdict_contribution_edges_total 0" in rendered
        assert "verdict_reputation_lookups_total 0" in rendered

    def test_records_a_contribution_batch(self):
        metrics = MetricsRegistry()
        metrics.record_contribution(5)
        metrics.record_contribution(3)
        assert metrics.contribution_batches_total == 2
        assert metrics.contribution_edges_total == 8

    def test_records_a_lookup(self):
        metrics = MetricsRegistry()
        metrics.record_lookup()
        metrics.record_lookup()
        assert metrics.reputation_lookups_total == 2

    def test_records_a_recompute_run(self):
        metrics = MetricsRegistry()
        metrics.record_recompute(4)
        metrics.record_recompute(1)
        assert metrics.recompute_runs_total == 2
        assert metrics.recompute_flagged_total == 5

    def test_records_a_backup(self):
        metrics = MetricsRegistry()
        metrics.record_backup()
        metrics.record_backup()
        assert metrics.backups_total == 2

    def test_records_a_backup_failure(self):
        metrics = MetricsRegistry()
        metrics.record_backup_failure()
        assert metrics.backup_failures_total == 1

    def test_renders_one_counter_line_per_metric(self):
        metrics = MetricsRegistry()
        metrics.record_contribution(2)
        metrics.record_lookup()
        metrics.record_recompute(1)
        metrics.record_backup()
        metrics.record_backup_failure()
        rendered = metrics.render_prometheus()
        assert "verdict_contribution_batches_total 1" in rendered
        assert "verdict_contribution_edges_total 2" in rendered
        assert "verdict_reputation_lookups_total 1" in rendered
        assert "verdict_recompute_runs_total 1" in rendered
        assert "verdict_recompute_flagged_total 1" in rendered
        assert "verdict_backups_total 1" in rendered
        assert "verdict_backup_failures_total 1" in rendered
        assert rendered.endswith("\n")
