import re
from dataclasses import dataclass
from pathlib import Path

# PRIVACY.md section 4 commits to a published reverse proxy configuration with IP logging disabled:
# "if we ever cannot demonstrate this, the feature comes out." A config file alone is a promise.
# this reader is what turns it into something a test can hold to, so an edit that re-enables logging
# fails the build instead of the audit.
#
# deliberately a small structural reader rather than a full Caddyfile parser. It answers only the
# questions PRIVACY.md makes claims about, and it fails loudly on a file it cannot follow rather
# than reporting that an unreadable config is fine.

CADDYFILE = Path(__file__).resolve().parents[1] / "deploy" / "Caddyfile"

# every header carrying the client address that a proxy adds by default
CLIENT_ADDRESS_HEADERS = ("X-Forwarded-For", "X-Forwarded-Host", "X-Real-IP")


@dataclass(frozen=True)
class ProxyGuarantees:
    access_log_discarded: bool
    admin_api_disabled: bool
    stripped_request_headers: frozenset[str]
    stripped_upstream_headers: frozenset[str]
    allowed_paths: frozenset[str]


class DeployConfigError(ValueError):
    pass


def _strip_comments(text: str) -> str:
    return "\n".join(line.split("#", 1)[0] for line in text.splitlines())


def read_proxy_guarantees(path: Path = CADDYFILE) -> ProxyGuarantees:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as error:
        raise DeployConfigError(f"the published proxy configuration is missing: {error}") from error

    body = _strip_comments(raw)
    if "reverse_proxy" not in body:
        raise DeployConfigError("no reverse_proxy directive, this is not the proxy configuration")

    # `log { output discard }`, allowing any whitespace or newlines between
    # the braces, and nothing else inside them: a log block that also names
    # a file would match a looser pattern and would not be a guarantee.
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
    )


# one string per broken guarantee, empty when the published configuration
# still says what PRIVACY.md says it says.
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
    return problems
