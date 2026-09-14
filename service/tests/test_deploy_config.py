import pytest

from verdict_service.deploy_config import (
    CADDYFILE,
    CLIENT_ADDRESS_HEADERS,
    DeployConfigError,
    ProxyGuarantees,
    parse_size,
    proxy_problems,
    read_proxy_guarantees,
)


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


def test_a_metrics_endpoint_added_to_the_allowlist_is_a_problem(tmp_path):
    body = CADDYFILE.read_text(encoding="utf-8").replace(
        "@allowed path /v1/reputation/lookup", "@allowed path /v1/metrics /v1/reputation/lookup"
    )
    problems = proxy_problems(read_proxy_guarantees(_write(tmp_path, body)))
    assert problems == ["/v1/metrics is reachable from the internet but is not a public endpoint"]


def test_a_wildcard_allowlist_is_a_problem(tmp_path):
    body = CADDYFILE.read_text(encoding="utf-8").replace(
        "@allowed path /v1/reputation/lookup /v1/graph/contribute", "@allowed path /v1/*"
    )
    assert any(
        "/v1/*" in problem
        for problem in proxy_problems(read_proxy_guarantees(_write(tmp_path, body)))
    )


def test_a_second_upstream_outside_the_allowlist_is_a_problem(tmp_path):
    body = CADDYFILE.read_text(encoding="utf-8").replace(
        "\thandle {\n\t\trespond 404",
        "\thandle /v1/health {\n\t\treverse_proxy verdict-service:8000\n\t}\n\n"
        "\thandle {\n\t\trespond 404",
    )
    assert body != CADDYFILE.read_text(encoding="utf-8")
    guarantees = read_proxy_guarantees(_write(tmp_path, body))
    assert guarantees.unguarded_upstreams == 1
    assert any("outside handle @allowed" in problem for problem in proxy_problems(guarantees))


def test_an_upstream_at_the_site_level_is_a_problem(tmp_path):
    path = _write(tmp_path, "api.example {\n\treverse_proxy app:8000\n}\n")
    assert read_proxy_guarantees(path).unguarded_upstreams == 1


def test_the_published_configuration_has_no_unguarded_upstream():
    assert read_proxy_guarantees().unguarded_upstreams == 0


def test_the_published_configuration_limits_request_bodies():
    assert read_proxy_guarantees().max_request_body_bytes == 2 * 1024 * 1024


def test_removing_the_body_limit_is_a_problem(tmp_path):
    body = CADDYFILE.read_text(encoding="utf-8").replace("max_size 2MiB", "")
    body = body.replace("request_body {\n\t\t\n\t}", "")
    guarantees = read_proxy_guarantees(_write(tmp_path, body))
    assert guarantees.max_request_body_bytes is None
    assert any("no size limit" in problem for problem in proxy_problems(guarantees))


def test_a_commented_out_body_limit_does_not_count(tmp_path):
    path = _write(tmp_path, "reverse_proxy app:8000\n# request_body { max_size 1MB }\n")
    assert read_proxy_guarantees(path).max_request_body_bytes is None


@pytest.mark.parametrize(
    ("text", "expected"),
    [("2MiB", 2097152), ("2MB", 2000000), ("512KiB", 524288), ("100", 100), ("1.5MB", 1500000)],
)
def test_sizes_parse_the_way_caddy_reads_them(text, expected):
    assert parse_size(text) == expected


def test_an_unknown_size_unit_is_not_guessed():
    assert parse_size("2 lots") is None
