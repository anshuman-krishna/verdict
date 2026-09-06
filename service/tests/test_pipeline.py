from verdict_service.graph.community_scoring import ReviewRecord
from verdict_service.graph.hashing import reviewer_hash
from verdict_service.graph.pipeline import compute_flagged_hashes

SALT = "test-salt"


def test_compute_flagged_hashes_end_to_end():
    # a pair, not a larger clique: backbone.py's disparity filter only
    # keeps an edge that dominates one of its endpoints' own weight
    # distribution, and a node with exactly one significant edge always
    # qualifies (backbone.py's degree <= 1 special case). A larger clique
    # of perfectly symmetric overlaps, by contrast, has every edge tied
    # for that node's whole distribution and none of them stands out, so
    # the filter (correctly) drops all of them; that is real behaviour of
    # the algorithm, not a gap in this pipeline.
    tight_group = ["f1", "f2"]
    reviewer_products = {
        # the same tight, significant overlap test_bipartite.py hand
        # checks (p_value = 1/120 against 10 total products).
        **{reviewer: {"p1", "p2", "p3"} for reviewer in tight_group},
        # unrelated, single product reviewers: never share anything with
        # anyone, so they can never form a significant edge, appear in no
        # community, and must never be flagged.
        "g1": {"p4"},
        "g2": {"p6"},
        # padding so total_products reaches 10, matching the hand checked
        # p_value from test_bipartite.py exactly.
        "pad": {"p5", "p7", "p8", "p9", "p10"},
    }
    reviews = [
        ReviewRecord(reviewer_id=reviewer, rating=5, day_index=100, category="kitchen")
        for reviewer in tight_group
    ] + [
        ReviewRecord(reviewer_id="g1", rating=3, day_index=10, category="toys"),
        ReviewRecord(reviewer_id="g2", rating=1, day_index=900, category="electronics"),
    ]

    flagged = compute_flagged_hashes(reviewer_products, reviews, SALT)

    assert flagged == {reviewer_hash(reviewer, SALT) for reviewer in tight_group}
    assert reviewer_hash("g1", SALT) not in flagged
    assert reviewer_hash("g2", SALT) not in flagged


def test_compute_flagged_hashes_is_empty_with_no_significant_overlap():
    reviewer_products = {"a": {"p1"}, "b": {"p2"}}
    assert compute_flagged_hashes(reviewer_products, [], SALT) == set()


def test_compute_flagged_hashes_does_not_flag_a_loosely_correlated_community():
    reviewer_products = {
        "a": {"p1", "p2", "p3"},
        "b": {"p1", "p2", "p3"},
        "pad": {"p4", "p5", "p6", "p7", "p8", "p9", "p10"},
    }
    # significant overlap (same shape as the hand checked bipartite case),
    # but their actual reviews look nothing alike, so scoring should not
    # flag the community even though the graph edge is significant.
    reviews = [
        ReviewRecord(reviewer_id="a", rating=1, day_index=0, category="kitchen"),
        ReviewRecord(reviewer_id="b", rating=5, day_index=365, category="electronics"),
    ]
    assert compute_flagged_hashes(reviewer_products, reviews, SALT) == set()
