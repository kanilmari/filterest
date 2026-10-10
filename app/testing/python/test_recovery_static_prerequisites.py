"""test_recovery_static_prerequisites.py: static lifecycle refusal sweep.

Exercise actual updater, native setup validators, Docker planner and restore.
Existing inputs must refuse before stop, backup, source or protected-state writes.
All database, Docker and release transports are isolated local fixtures.
"""
from __future__ import annotations

import gzip
import json
import os
from pathlib import Path
import subprocess

import pytest

from test_native_lifecycle_roots import SOURCE_ROOT, build_update_fixture, run_update
from test_update_prerequisites_before_downtime import installation_snapshot, assert_untouched, package_probe
from test_recovery_content_sinks import KEY
from test_database_recovery import packet, create_packet, run_packet, calls
from server_tools.lib import database_recovery as recovery


@pytest.mark.parametrize("change", ("docker-duplicate", "runtime-duplicate", "api-conflict", "tls-pair",
                                   "legacy-env", "invalid-edge", "invalid-port", "invalid-project",
                                   "invalid-network", "runtime-dir", "bootstrap-source", "directory-type"))
def test_actual_docker_updater_static_start_refusals_are_before_shutdown(tmp_path, change):
    fixture = build_update_fixture(tmp_path, "docker")
    root = fixture["checkout"]
    settings = root / "keys/docker.env"
    runtime = root / "keys/filterest_runtime/runtime_environment.env"
    if change == "docker-duplicate":
        with settings.open("a") as output: output.write("FILTEREST_APP_VERSION=again\n")
    elif change == "runtime-duplicate":
        runtime.write_text("OPENAI_API_KEY=\nOPENAI_API_KEY=\n")
    elif change == "api-conflict":
        with settings.open("a") as output: output.write("OPENAI_API_KEY=synthetic-a\n")
        runtime.write_text("OPENAI_API_KEY=synthetic-b\n")
    elif change == "tls-pair":
        (root / "keys/tls/localhost.key").unlink()
    elif change == "legacy-env":
        (root / ".env").write_text("legacy=1\n")
    elif change in ("invalid-edge", "invalid-port", "invalid-project", "invalid-network"):
        key, value = {"invalid-edge": ("FILTEREST_EDGE", "unknown"), "invalid-port": ("APP_PORT", "70000"),
                      "invalid-project": ("COMPOSE_PROJECT_NAME", "INVALID"),
                      "invalid-network": ("FILTEREST_NETWORK_GATEWAY", "192.0.2.1")}[change]
        lines = [line for line in settings.read_text().splitlines() if not line.startswith(key + "=")]
        settings.write_text("\n".join([*lines, key + "=" + value]) + "\n")
    elif change == "runtime-dir":
        runtime.unlink(); runtime.mkdir()
    elif change == "bootstrap-source":
        (root / "app/server_tools/db_init").write_text("not a directory\n")
    else:
        (root / "data/postgres").rmdir()
        (root / "data/postgres").write_text("not a directory\n")
    before = installation_snapshot(root)
    result = run_update(fixture, "--yes")
    assert result.returncode != 0, result.stdout
    assert_untouched(fixture, before)


def native_settings(fixture):
    root = fixture["checkout"]
    content = (SOURCE_ROOT / ".env.example").read_text()
    content = content.replace("FILTEREST_INSTALL_PROFILE=\n", "FILTEREST_INSTALL_PROFILE=admin\n")
    for name in ("runtime_environment.env", "development_environment.env"):
        file = root / "keys/filterest_runtime" / name
        file.write_text(content); file.chmod(0o600)
    package_probe(fixture)
    tls = root / "keys/filterest_runtime/local_tls_certificate"
    tls.mkdir(mode=0o700)
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
                    "-keyout", str(tls / "localhost_private_key.key"), "-out", str(tls / "localhost_certificate.crt")],
                   check=True, capture_output=True)


@pytest.mark.parametrize("change", ("duplicate", "invalid-port", "port-mismatch", "short-session", "unsafe-role",
                                   "invalid-proxy", "missing-site", "invalid-marker", "host-architecture", "host-glibc",
                                   "missing-tls", "invalid-tls"))
def test_actual_native_updater_reuses_installer_preflight_before_shutdown(tmp_path, change):
    fixture = build_update_fixture(tmp_path, "admin", real_native_installer=True)
    native_settings(fixture)
    root = fixture["checkout"]
    file = root / "keys/filterest_runtime/runtime_environment.env"
    if change == "duplicate":
        with file.open("a") as output: output.write("ENVIRONMENT_TYPE=prod\n")
    elif change == "invalid-marker":
        (root / "data/runtime/filterest-installation-id").write_text("invalid\n")
    elif change in ("missing-tls", "invalid-tls"):
        certificate = root / "keys/filterest_runtime/local_tls_certificate/localhost_certificate.crt"
        if change == "missing-tls": certificate.unlink()
        else: certificate.write_text("invalid certificate\n")
    elif change in ("host-architecture", "host-glibc"):
        tool = root.parent / "bin" / ("uname" if change == "host-architecture" else "getconf")
        tool.write_text("#!/bin/bash\n" + ('[[ "$1" == -s ]] && echo Linux || echo unsupported\n' if change == "host-architecture" else 'echo "glibc 2.20"\n'))
        tool.chmod(0o700)
    else:
        key, value = {"invalid-port": ("APP_PORT", "bad"), "port-mismatch": ("PORT", "8101"),
                      "short-session": ("SESSION_KEY", "short"), "unsafe-role": ("DB_ADMIN_USER", "bad-role"),
                      "invalid-proxy": ("EASELECT_TRUSTED_PROXY_PEER_IPS", "bad-ip"),
                      "missing-site": ("SITE_NAME", "")}[change]
        content = [line for line in file.read_text().splitlines() if not line.startswith(key + "=")]
        file.write_text("\n".join([*content, key + "=" + value]) + "\n")
    before = installation_snapshot(root)
    result = run_update(fixture, "--yes")
    assert result.returncode != 0, result.stdout
    assert_untouched(fixture, before)


def test_native_read_only_preflight_accepts_projected_setup_values_without_writes(tmp_path):
    fixture = build_update_fixture(tmp_path, "admin", real_native_installer=True)
    native_settings(fixture)
    root = fixture["checkout"]
    before = installation_snapshot(root)
    result = subprocess.run(["bash", str(root / "app/server_tools/install_filterest.sh"), "--profile", "admin", "--update-preflight"],
                            env=dict(fixture["environment"], FILTEREST_RECOVERY_CONTENT_ROOT=str(root), FILTEREST_RECOVERY_OUTPUT="1"), capture_output=True)
    assert result.returncode == 0, result.stderr
    assert installation_snapshot(root) == before


@pytest.mark.parametrize("compressed", (False, True))
def test_legacy_restore_existing_key_sql_refuses_before_stop_and_evidence(tmp_path, compressed):
    keys = tmp_path / "keys"; keys.mkdir(mode=0o700)
    key = keys / "database_recovery.hmac.key"; key.write_text(KEY.hex()+"\n"); key.chmod(0o600)
    instance = tmp_path / "instances/proof"; instance.mkdir(parents=True)
    (instance / ".env").write_text("DB_ADMIN_USER=fixture\nDB_NAME=fixture\n")
    dump = tmp_path / ("dump.sql.gz" if compressed else "dump.sql")
    content = b"-- " + KEY.hex().encode() + b"\nSELECT 1;\n"
    dump.write_bytes(gzip.compress(content) if compressed else content)
    script = '''source "$1"
project_default_db_name() { printf fixture; }
docker() { printf '%s\\n' "$*" >> commands; }
restore_instance proof "$2"
'''
    before = restore_snapshot(tmp_path)
    result = subprocess.run(["bash", "-c", script, "check", str(SOURCE_ROOT / "server_tools/ctl/lib/instance_backup.sh"), str(dump)],
                            cwd=tmp_path, env=dict(os.environ, PROJECT_ROOT=str(tmp_path), EASELECT_RESTORE_CONFIRM="yes"), capture_output=True)
    assert result.returncode != 0 and b"Recovery content refused" in result.stderr
    assert KEY.hex().encode() not in result.stdout + result.stderr
    assert not (tmp_path / "commands").exists()
    assert restore_snapshot(tmp_path) == before


def restore_snapshot(root):
    return {str(path.relative_to(root)): (path.stat().st_mode, path.read_bytes() if path.is_file() else None)
            for path in sorted(root.rglob("*"))}


@pytest.mark.parametrize("change", ("untracked", "rename-target", "parent-mode", "root-mode", "git-lock"))
def test_actual_updater_checkout_obstructions_refuse_before_shutdown(tmp_path, change):
    fixture = build_update_fixture(tmp_path, "admin", target_rename=change == "rename-target")
    root = fixture["checkout"]
    if change in ("untracked", "rename-target"): (root / "app/RELEASE_NOTES.txt").write_text("operator copy\n")
    if change == "parent-mode": (root / "app").chmod(0o500)
    if change == "root-mode": root.chmod(0o500)
    if change == "git-lock": (root / ".git/index.lock").touch()
    before = installation_snapshot(root)
    try:
        result = run_update(fixture, "--yes")
        assert result.returncode != 0 and "Recovery checkout preflight refused" in result.stderr
        assert_untouched(fixture, before)
    finally:
        if change == "parent-mode": (root / "app").chmod(0o755)
        if change == "root-mode": root.chmod(0o755)


@pytest.mark.parametrize("change", ("missing-counts", "missing-limit", "invalid-limit", "invalid-count", "empty-catalogue",
                                   "missing-owner", "invalid-settings", "invalid-acl"))
def test_authenticated_existing_properties_refuse_before_native_restore_stop(packet, change):
    create_packet(packet)
    packet["log"].unlink()
    folder = packet["backup"]
    properties = json.loads((folder / recovery.PROPERTIES).read_text())
    if change == "missing-counts": properties.pop("counts")
    if change == "missing-limit": properties["database"]["properties"].pop("datconnlimit")
    if change == "invalid-limit": properties["database"]["properties"]["datconnlimit"] = "bad"
    if change == "invalid-count": properties["counts"]["functions"] = "bad"
    if change == "empty-catalogue": properties["counts"]["relations"] = 0
    if change == "missing-owner": properties["database"].pop("owner")
    if change == "invalid-settings": properties["database"]["settings"] = [{"role": None, "values": ["invalid"]}]
    if change == "invalid-acl": properties["database"]["acl"] = [{"grantor": "site_admin"}]
    (folder / recovery.PROPERTIES).write_bytes(recovery.canonical(properties))
    record = json.loads((folder / recovery.RECORD).read_text())
    record["files"][recovery.PROPERTIES] = recovery.digest(folder / recovery.PROPERTIES)
    key = recovery.packet_key(packet["root"], "native", [packet["settings"]])
    record["mac"] = recovery.packet_mac(record, key)
    (folder / recovery.RECORD).write_bytes(recovery.canonical(record))
    (folder / recovery.CHECKSUMS).write_text("".join(f"{record['files'][name]}  {name}\n" for name in sorted(record["files"])))
    before = restore_snapshot(packet["root"])
    result = run_packet(packet, "restore", "--backup", str(folder), "--yes")
    assert result.returncode != 0 and "application unchanged" in result.stderr
    assert not [call for call in calls(packet) if call["tool"] == "ctl" or call["phase"] != "read"]
    assert restore_snapshot(packet["root"]) == before
