import re
from dataclasses import dataclass
from pathlib import Path

CADDYFILE = Path(__file__).resolve().parents[1] / "deploy" / "Caddyfile"

CLIENT_ADDRESS_HEADERS = ("X-Forwarded-For", "X-Forwarded-Host", "X-Real-IP")
PUBLIC_ENDPOINTS = frozenset({"/v1/reputation/lookup", "/v1/graph/contribute"})


@dataclass(frozen=True)
class ProxyGuarantees:
    access_log_discarded: bool
    admin_api_disabled: bool
    stripped_request_headers: frozenset[str]
    stripped_upstream_headers: frozenset[str]
    allowed_paths: frozenset[str]
    unguarded_upstreams: int = 0
    max_request_body_bytes: int | None = None


class DeployConfigError(ValueError):
    pass


def _strip_comments(text: str) -> str:
    return "\n".join(line.split("#", 1)[0] for line in text.splitlines())


_SIZE_UNITS = {
    "": 1,
    "b": 1,
    "kb": 1000,
    "mb": 1000**2,
    "gb": 1000**3,
    "kib": 1024,
    "mib": 1024**2,
    "gib": 1024**3,
}


def parse_size(text: str) -> int | None:
    match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([a-zA-Z]*)", text.strip())
    if match is None or match.group(2).lower() not in _SIZE_UNITS:
        return None
    return int(float(match.group(1)) * _SIZE_UNITS[match.group(2).lower()])


def _max_request_body_bytes(body: str) -> int | None:
    sizes = [
        parse_size(match.group(1))
        for match in re.finditer(r"request_body\s*\{[^}]*?max_size\s+(\S+)", body)
    ]
    known = [size for size in sizes if size is not None]
    return max(known) if known and len(known) == len(sizes) else None


def _enclosing_block_headers(body: str, index: int) -> list[str]:
    headers: list[str] = []
    depth = 0
    for position in range(index - 1, -1, -1):
        character = body[position]
        if character == "}":
            depth += 1
        elif character == "{":
            if depth:
                depth -= 1
                continue
            line_start = body.rfind("\n", 0, position) + 1
            headers.append(body[line_start:position].strip())
    return headers


def _unguarded_upstreams(body: str) -> int:
    unguarded = 0
    for match in re.finditer(r"\breverse_proxy\b", body):
        handles = [
            header
            for header in _enclosing_block_headers(body, match.start())
            if header.split()[:1] in (["handle"], ["route"], ["handle_path"])
        ]
        if not handles or handles[0] != "handle @allowed":
            unguarded += 1
    return unguarded


def read_proxy_guarantees(path: Path = CADDYFILE) -> ProxyGuarantees:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as error:
        raise DeployConfigError(f"the published proxy configuration is missing: {error}") from error

    body = _strip_comments(raw)
    if "reverse_proxy" not in body:
        raise DeployConfigError("no reverse_proxy directive, this is not the proxy configuration")

    access_log_discarded = re.search(r"\blog\s*\{\s*output\s+discard\s*\}", body) is not None
    admin_api_disabled = re.search(r"^\s*admin\s+off\s*$", body, re.MULTILINE) is not None

    stripped_request = {match.group(1) for match in re.finditer(r"request_header\s+-(\S+)", body)}
    stripped_upstream = {match.group(1) for match in re.finditer(r"header_up\s+-(\S+)", body)}

    allowed = set()
    for match in re.finditer(r"@allowed\s+path\s+(.+)", body):
        allowed.update(match.group(1).split())

    return ProxyGuarantees(
        access_log_discarded=access_log_discarded,
        admin_api_disabled=admin_api_disabled,
        stripped_request_headers=frozenset(stripped_request),
        stripped_upstream_headers=frozenset(stripped_upstream),
        allowed_paths=frozenset(allowed),
        unguarded_upstreams=_unguarded_upstreams(body),
        max_request_body_bytes=_max_request_body_bytes(body),
    )


def proxy_problems(guarantees: ProxyGuarantees) -> list[str]:
    problems: list[str] = []
    if not guarantees.access_log_discarded:
        problems.append("the access log is not discarded, so requests are written down")
    if not guarantees.admin_api_disabled:
        problems.append("the admin api is not off")
    for header in CLIENT_ADDRESS_HEADERS:
        if header not in guarantees.stripped_request_headers:
            problems.append(f"{header} is not stripped from incoming requests")
        if header not in guarantees.stripped_upstream_headers:
            problems.append(f"{header} is not stripped before the request reaches the application")
    for header in ("Referer", "Cookie"):
        if header not in guarantees.stripped_request_headers:
            problems.append(f"{header} is not stripped, and PRIVACY.md section 4 says it is")
    if guarantees.max_request_body_bytes is None:
        problems.append("request bodies have no size limit, one upload can exhaust memory")
    for path in sorted(guarantees.allowed_paths - PUBLIC_ENDPOINTS):
        problems.append(f"{path} is reachable from the internet but is not a public endpoint")
    if guarantees.unguarded_upstreams:
        problems.append(
            f"{guarantees.unguarded_upstreams} reverse_proxy directive(s) sit outside "
            "handle @allowed, so any path reaches the application"
        )
    return problems
