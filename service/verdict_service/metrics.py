import threading
from dataclasses import dataclass, field


@dataclass
class MetricsRegistry:
    """counts, never contents: aggregate totals only, no per-request detail"""

    contribution_batches_total: int = 0
    contribution_edges_total: int = 0
    reputation_lookups_total: int = 0
    recompute_runs_total: int = 0
    recompute_flagged_total: int = 0
    backups_total: int = 0
    backup_failures_total: int = 0
    contributions_refused_total: int = 0
    prune_failures_total: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    def record_contribution(self, edge_count: int) -> None:
        with self._lock:
            self.contribution_batches_total += 1
            self.contribution_edges_total += edge_count

    def record_contribution_refused(self) -> None:
        with self._lock:
            self.contributions_refused_total += 1

    def record_prune_failure(self) -> None:
        with self._lock:
            self.prune_failures_total += 1

    def record_lookup(self) -> None:
        with self._lock:
            self.reputation_lookups_total += 1

    def record_recompute(self, flagged_count: int) -> None:
        with self._lock:
            self.recompute_runs_total += 1
            self.recompute_flagged_total += flagged_count

    def record_backup(self) -> None:
        with self._lock:
            self.backups_total += 1

    def record_backup_failure(self) -> None:
        with self._lock:
            self.backup_failures_total += 1

    def render_prometheus(self, gauges: dict[str, float] | None = None) -> str:
        with self._lock:
            counters = {
                "verdict_contribution_batches_total": self.contribution_batches_total,
                "verdict_contribution_edges_total": self.contribution_edges_total,
                "verdict_reputation_lookups_total": self.reputation_lookups_total,
                "verdict_recompute_runs_total": self.recompute_runs_total,
                "verdict_recompute_flagged_total": self.recompute_flagged_total,
                "verdict_backups_total": self.backups_total,
                "verdict_backup_failures_total": self.backup_failures_total,
                "verdict_contributions_refused_total": self.contributions_refused_total,
                "verdict_prune_failures_total": self.prune_failures_total,
            }
        lines = [f"# TYPE {name} counter\n{name} {value}" for name, value in counters.items()]
        lines += [f"# TYPE {name} gauge\n{name} {value}" for name, value in (gauges or {}).items()]
        return "\n".join(lines) + "\n"
