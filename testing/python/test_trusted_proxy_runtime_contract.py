#!/usr/bin/env python3
"""test_trusted_proxy_runtime_contract.py
Verifies exact proxy peers, safe nginx headers, and runtime propagation.
Bridges maintainer source checks with the generated public Filterest layout.
Exists so client identity cannot silently collapse or become spoofable again.
"""

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ENV_NAME = "EASELECT_TRUSTED_PROXY_PEER_IPS"
MAINTAINER_SOURCE = (
    ROOT / "docs/public_release_drafts/README_PUBLIC_DRAFT.md"
).is_file()


def public_readme() -> str:
    source = (
        ROOT / "docs/public_release_drafts/README_PUBLIC_DRAFT.md"
        if MAINTAINER_SOURCE
        else ROOT / "README.md"
    )
    return source.read_text(encoding="utf-8")


def test_docker_app_services_propagate_the_protected_proxy_allowlist() -> None:
    expected = f"- {ENV_NAME}=${{{ENV_NAME}:-}}"
    for relative_path in (
        "docker/docker-compose.instance.yml",
        "docker/docker-compose.yml",
        "docker/docker-compose.mcp.yml",
    ):
        source = (ROOT / relative_path).read_text(encoding="utf-8")
        assert source.count(expected) == 1, relative_path


def test_scaffolds_preserve_the_exact_peer_setting() -> None:
    if MAINTAINER_SOURCE:
        source = (ROOT / "instances/template.env").read_text(encoding="utf-8")
        assert source.count(f"{ENV_NAME}=") == 2  # Example plus blank value.
        assert "Never enter a private subnet or CIDR here" in source
        assert f"{ENV_NAME}=172.18.0.1" in source
        paths = (
            ".env.scaffold",
            ".env.example",
            "dev_env.scaffold",
            "instances/serlog.com/.env.scaffold",
            "instances/easelect.com/.env.scaffold",
            "instances/tukisuu.fi/.env.scaffold",
            "instances/mcp.env.example",
            "server_tools/public_slice_export/templates/env.scaffold",
        )
    else:
        paths = (
            ".env.example",
            "server_tools/scaffolds/runtime.env.scaffold",
            "server_tools/scaffolds/development.env.scaffold",
        )

    for relative_path in paths:
        lines = (ROOT / relative_path).read_text(encoding="utf-8").splitlines()
        assert lines.count(f"{ENV_NAME}=") == 1, relative_path


def test_public_export_reuses_the_validated_environment_scaffold() -> None:
    if not MAINTAINER_SOURCE:
        return
    generator = (
        ROOT / "server_tools/public_slice_export/generate_filterest_public_repo.sh"
    ).read_text(encoding="utf-8")
    assert '"$REPO_ROOT/docs/public_release_drafts/README_PUBLIC_DRAFT.md"' in generator
    assert '"$target_dir/README.md"' in generator
    assert 'cp -p "$TEMPLATE_DIR/env.scaffold" "$target_dir/.env.example"' in generator
    assert '"$target_dir/server_tools/scaffolds/runtime.env.scaffold"' in generator
    assert '"$target_dir/server_tools/scaffolds/development.env.scaffold"' in generator


def test_public_export_ships_proxy_boundary_and_operator_guidance() -> None:
    required_paths = (
        "server_tools/nginx/filterest_cloudflare_real_ip.conf",
        "server_tools/nginx/filterest_sanitized_proxy_headers.conf",
        "testing/python/test_trusted_proxy_runtime_contract.py",
    )
    if MAINTAINER_SOURCE:
        allowlist = (
            ROOT / "server_tools/public_slice_export/allowlist.txt"
        ).read_text(encoding="utf-8").splitlines()
        for required_path in required_paths:
            assert allowlist.count(required_path) == 1
    else:
        for required_path in required_paths:
            assert (ROOT / required_path).is_file(), required_path

    readme = public_readme()
    assert "server_tools/nginx/filterest_cloudflare_real_ip.conf" in readme
    assert "server_tools/nginx/filterest_sanitized_proxy_headers.conf" in readme
    assert "never a subnet or CIDR" in readme


def test_nginx_cloudflare_sources_match_application_defaults() -> None:
    go_source = (
        ROOT
        / "backend/core_components/middlewares/firewall/trusted_proxy_config.go"
    ).read_text(encoding="utf-8")
    default_block = go_source.split("var defaultTrustedProxyCIDRs", 1)[1].split("}", 1)[0]
    app_ranges = set(re.findall(r'"([0-9a-fA-F:.]+/\d+)"', default_block))
    app_ranges -= {"127.0.0.1/32", "::1/128"}

    nginx_source = (
        ROOT / "server_tools/nginx/filterest_cloudflare_real_ip.conf"
    ).read_text(encoding="utf-8")
    nginx_ranges = set(re.findall(r"^set_real_ip_from ([^;]+);$", nginx_source, re.MULTILINE))
    assert nginx_ranges == app_ranges
    assert "real_ip_header CF-Connecting-IP;" in nginx_source
    assert "real_ip_recursive on;" in nginx_source


def test_nginx_downstream_client_headers_are_canonical_not_appended() -> None:
    source = (
        ROOT / "server_tools/nginx/filterest_sanitized_proxy_headers.conf"
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

    if MAINTAINER_SOURCE:
        for relative_path in (
            "docs/instructions_and_documentation/Production_Deployment.md",
            "docs/instructions_and_documentation/Multi_Instance_Deployment.md",
        ):
            deployment_doc = (ROOT / relative_path).read_text(encoding="utf-8")
            assert "filterest_cloudflare_real_ip.conf" in deployment_doc
            assert "filterest_sanitized_proxy_headers.conf" in deployment_doc
            assert "$proxy_add_x_forwarded_for" not in deployment_doc


def test_login_logging_has_no_reverse_dns_or_hostname_cache() -> None:
    source = (
        ROOT / "backend/core_components/auth/login_rate_checker.go"
    ).read_text(encoding="utf-8")
    assert "LookupAddr(" not in source
    assert "loginReverseDNS" not in source
    assert "logLoginAttemptIP" in source
