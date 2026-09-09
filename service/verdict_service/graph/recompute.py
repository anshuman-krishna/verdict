import time
from collections.abc import Callable

from verdict_service.api.store import FlaggedHashStore
from verdict_service.graph.contribution_store import ContributionEdgeStore
from verdict_service.graph.pipeline import compute_flagged_hashes_from_contributions

RETENTION_SECONDS = 90 * 24 * 60 * 60


def recompute_flagged_hashes(
    contribution_store: ContributionEdgeStore,
    flagged_store: FlaggedHashStore,
    now: Callable[[], float] = time.time,
    retention_seconds: float = RETENTION_SECONDS,
) -> int:
    """Recompute communities from currently retained edges and fold any
    newly flagged hashes into flagged_store.

    Only ever adds. PRIVACY.md section 8 keeps derived community
    assignments after their source edges age out of the 90 day retention
    window ("only the derived community assignments are kept"), so a
    hash flagged by a past run must survive this run finding, from a
    smaller or differently shaped edge set, that it would not flag that
    reviewer again today. flagged_store has no remove for the same
    reason: nothing in this pipeline is a considered decision to lift a
    flag, only an artifact of which edges happen to still be retained.

    Returns how many hashes this run flagged, retained or not.
    """
    cutoff = now() - retention_seconds
    edges = contribution_store.list_since(cutoff)
    flagged = compute_flagged_hashes_from_contributions(edges)
    add_many = getattr(flagged_store, "add_many", None)
    if callable(add_many):
        add_many(list(flagged))
    else:
        for full_hash in flagged:
            flagged_store.add(full_hash)
    return len(flagged)
