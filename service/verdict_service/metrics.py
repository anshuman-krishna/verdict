from dataclasses import dataclass


@dataclass
class MetricsRegistry:
    """counts, never contents: aggregate totals only, no per-request detail"""

    contribution_batches_total: int = 0
    contribution_edges_total: int = 0
    reputation_lookups_total: int = 0
    recompute_runs_total: int = 0
    recompute_flagged_total: int = 0

    def record_contribution(self, edge_count: int) -> None:
        self.contribution_batches_total += 1
        self.contribution_edges_total += edge_count

    def record_lookup(self) -> None:
        self.reputation_lookups_total += 1

    def record_recompute(self, flagged_count: int) -> None:
        self.recompute_runs_total += 1
        self.recompute_flagged_total += flagged_count

    def render_prometheus(self) -> str:
        counters = {
            "verdict_contribution_batches_total": self.contribution_batches_total,
            "verdict_contribution_edges_total": self.contribution_edges_total,
            "verdict_reputation_lookups_total": self.reputation_lookups_total,
            "verdict_recompute_runs_total": self.recompute_runs_total,
            "verdict_recompute_flagged_total": self.recompute_flagged_total,
        }
        lines = [f"# TYPE {name} counter\n{name} {value}" for name, value in counters.items()]
        return "\n".join(lines) + "\n"
