from verdict_service.graph.hashing import reviewer_hash


class TestReviewerHash:
    def test_known_sha256_vector_for_the_empty_string(self):
        # confirms hashlib is actually being invoked correctly: sha256 of
        # an empty input is a widely published constant.
        assert (
            reviewer_hash("", "")
            == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        )

    def test_is_deterministic(self):
        assert reviewer_hash("bad-actor", "salt") == reviewer_hash("bad-actor", "salt")

    def test_is_a_64_character_lowercase_hex_string(self):
        result = reviewer_hash("someone", "salt")
        assert len(result) == 64
        assert set(result) <= set("0123456789abcdef")

    def test_different_reviewer_ids_produce_different_hashes(self):
        assert reviewer_hash("alice", "salt") != reviewer_hash("bob", "salt")

    def test_different_salts_produce_different_hashes(self):
        assert reviewer_hash("alice", "salt-a") != reviewer_hash("alice", "salt-b")

    def test_concatenates_id_and_salt_directly_with_no_separator(self):
        # this must match extension/src/reputation/lookup.ts's
        # `${reviewerId}${salt}` exactly, so "ab" + "cd" and "a" + "bcd"
        # collide the same way on both sides rather than diverging.
        assert reviewer_hash("ab", "cd") == reviewer_hash("a", "bcd")
