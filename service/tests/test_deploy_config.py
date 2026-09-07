import pytest

from verdict_service.deploy_config import (
    CADDYFILE,
    CLIENT_ADDRESS_HEADERS,
    DeployConfigError,
    ProxyGuarantees,
    proxy_problems,
    read_proxy_guarantees,
)

# PRIVACY.md section 4: "the reverse proxy is configured with IP logging disabled, and that
# configuration file is in the public repository. If we ever cannot demonstrate this, the feature
# comes out." These assert the published file, not a copy of it, so the demonstration cannot drift
# away from what is deployed.


def test_the_published_configuration_exists():
    assert CADDYFILE.exists(), "PRIVACY.md section 4 promises this file is in the repository"


def test_the_published_configuration_keeps_every_guarantee():
    assert proxy_problems(read_proxy_guarantees()) == []


def test_the_access_log_is_discarded():
    assert read_proxy_guarantees().access_log_discarded


def test_the_admin_api_is_off():
    assert read_proxy_guarantees().admin_api_disabled


@pytest.mark.parametrize("header", CLIENT_ADDRESS_HEADERS)
def test_no_client_address_header_reaches_the_application(header):
    guarantees = read_proxy_guarantees()
    assert header in guarantees.stripped_request_headers
    assert header in guarantees.stripped_upstream_headers


def test_only_the_two_documented_endpoints_are_reachable():
    # SPEC.md section 8's lookup and PRIVACY.md section 5's contribution. A third path appearing
    # here is a new thing the internet can reach and is a deliberate act, not a refactor.
    assert read_proxy_guarantees().allowed_paths == {
        "/v1/reputation/lookup",
        "/v1/graph/contribute",
    }


def _write(tmp_path, body: str):
    path = tmp_path / "Caddyfile"
    path.write_text(body, encoding="utf-8")
    return path


def test_a_missing_configuration_is_an_error_not_a_pass(tmp_path):
    with pytest.raises(DeployConfigError):
        read_proxy_guarantees(tmp_path / "absent")


def test_a_file_that_is_not_a_proxy_configuration_is_refused(tmp_path):
    with pytest.raises(DeployConfigError):
        read_proxy_guarantees(_write(tmp_path, "log { output discard }\n"))


def test_a_commented_out_guarantee_does_not_count(tmp_path):
    path = _write(tmp_path, "reverse_proxy app:8000\n# log { output discard }\n# admin off\n")
    guarantees = read_proxy_guarantees(path)
    assert not guarantees.access_log_discarded
    assert not guarantees.admin_api_disabled


# a log that names a file is still a log, and the point of the guarantee is
# that there is not one.
def test_a_log_written_to_a_file_is_not_a_discarded_log(tmp_path):
    path = _write(tmp_path, "reverse_proxy app:8000\nlog { output file /var/log/access.log }\n")
    assert not read_proxy_guarantees(path).access_log_discarded


def test_problems_name_each_broken_guarantee():
    problems = proxy_problems(
        ProxyGuarantees(
            access_log_discarded=False,
            admin_api_disabled=False,
            stripped_request_headers=frozenset(),
            stripped_upstream_headers=frozenset(),
            allowed_paths=frozenset(),
        )
    )
    assert any("access log" in problem for problem in problems)
    assert any("admin api" in problem for problem in problems)
    assert any("X-Forwarded-For" in problem for problem in problems)
    assert any("Referer" in problem for problem in problems)
