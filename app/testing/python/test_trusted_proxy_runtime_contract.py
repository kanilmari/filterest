#!/usr/bin/env python3
"""test_trusted_proxy_runtime_contract.py
Verifies exact proxy peers, safe nginx headers, and public runtime propagation.
Runs unchanged against canonical and exported standalone Filterest layouts.
Exists so client identity cannot silently collapse or become spoofable again.
"""

import re
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[2]
PRODUCT_ROOT = APP_ROOT.parent if APP_ROOT.name == "app" else APP_ROOT
PUBLIC_SOURCE_ROOT = APP_ROOT
ENV_NAME = "EASELECT_TRUSTED_PROXY_PEER_IPS"


def public_readme() -> str:
    return (PRODUCT_ROOT / "README.md").read_text(encoding="utf-8")


def test_docker_app_services_propagate_the_protected_proxy_allowlist() -> None:
    relative_path = "docker/docker-compose.yml"
    source = (PUBLIC_SOURCE_ROOT / relative_path).read_text(encoding="utf-8")
    expected = f"{ENV_NAME}: ${{{ENV_NAME}:-}}"
    assert source.count(expected) == 1, relative_path


def test_scaffolds_preserve_the_exact_peer_setting() -> None:
    lines = (PUBLIC_SOURCE_ROOT / ".env.example").read_text(
        encoding="utf-8"
    ).splitlines()
    assert lines.count(f"{ENV_NAME}=") == 1


def test_public_export_ships_proxy_boundary_and_operator_guidance() -> None:
    public_source_paths = (
        "server_tools/nginx/filterest_cloudflare_real_ip.conf",
        "server_tools/nginx/filterest_sanitized_proxy_headers.conf",
    )
    required_paths = (*public_source_paths, "testing/python/test_trusted_proxy_runtime_contract.py")
    for required_path in required_paths:
        assert (PUBLIC_SOURCE_ROOT / required_path).is_file(), required_path

    readme = public_readme()
    assert "server_tools/nginx/filterest_cloudflare_real_ip.conf" in readme
    assert "server_tools/nginx/filterest_sanitized_proxy_headers.conf" in readme
    assert "never a subnet or CIDR" in readme


def test_nginx_cloudflare_sources_match_application_defaults() -> None:
    go_source = (
        PUBLIC_SOURCE_ROOT
        / "backend/core_components/middlewares/firewall/trusted_proxy_config.go"
    ).read_text(encoding="utf-8")
    default_block = go_source.split("var defaultTrustedProxyCIDRs", 1)[1].split("}", 1)[0]
    app_ranges = set(re.findall(r'"([0-9a-fA-F:.]+/\d+)"', default_block))
    app_ranges -= {"127.0.0.1/32", "::1/128"}

    nginx_source = (
        PUBLIC_SOURCE_ROOT / "server_tools/nginx/filterest_cloudflare_real_ip.conf"
    ).read_text(encoding="utf-8")
    nginx_ranges = set(re.findall(r"^set_real_ip_from ([^;]+);$", nginx_source, re.MULTILINE))
    assert nginx_ranges == app_ranges
    assert "real_ip_header CF-Connecting-IP;" in nginx_source
    assert "real_ip_recursive on;" in nginx_source


def test_nginx_downstream_client_headers_are_canonical_not_appended() -> None:
    source = (
        PUBLIC_SOURCE_ROOT / "server_tools/nginx/filterest_sanitized_proxy_headers.conf"
    ).read_text(encoding="utf-8")
    for expected in (
        'proxy_set_header CF-Connecting-IP "";',
        'proxy_set_header Forwarded "";',
        'proxy_set_header X-Client-IP "";',
        'proxy_set_header X-Real-IP $remote_addr;',
        'proxy_set_header X-Forwarded-For $remote_addr;',
    ):
        assert expected in source
    assert "$proxy_add_x_forwarded_for" not in source

    readme = public_readme()
    assert "server_tools/nginx/filterest_cloudflare_real_ip.conf" in readme
    assert "server_tools/nginx/filterest_sanitized_proxy_headers.conf" in readme

def test_login_logging_has_no_reverse_dns_or_hostname_cache() -> None:
    source = (
        PUBLIC_SOURCE_ROOT / "backend/core_components/auth/login_rate_checker.go"
    ).read_text(encoding="utf-8")
    assert "LookupAddr(" not in source
    assert "loginReverseDNS" not in source
    assert "logLoginAttemptIP" in source
