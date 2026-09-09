import hashlib


def reviewer_hash(reviewer_id: str, salt: str) -> str:
    return hashlib.sha256(f"{reviewer_id}{salt}".encode()).hexdigest()
