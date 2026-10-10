"""test_update_prerequisites_before_downtime.py
Proves recovery prerequisites refuse before shutdown and installation writes.
Connects the real updater/runner/package reader to isolated Git and tool fixtures.
Keeps target requirements inert and ordinary setup/migration behaviour intact.
"""
from __future__ import annotations

import os
from pathlib import Path
import stat
import subprocess

import pytest

from test_native_lifecycle_roots import (
    SOURCE_ROOT, assert_calls_in_order, build_update_fixture, clean_filterest_environment,
    git_output, logged_calls, run_update, update_backups,
)
from test_recovery_content_sinks import FORMS, KEY

CONTRACT = "app/server_tools/lib/native_host_packages.list"
GUIDANCE = "Recovery update requires host packages already installed; run ordinary setup first"
VOLUME_GUIDANCE = "Recovery startup refuses legacy volume copying; migrate with ordinary Docker start first"
RUNTIME_PACKAGES = (
    "ca-certificates", "curl", "openssl", "python3-minimal", "python3-psycopg2",
    "postgresql-common", "postgresql-16", "postgresql-client-16",
    "postgresql-16-postgis-3", "postgresql-16-postgis-3-scripts", "postgresql-16-pgvector",
)
VOLUMES = (
    "filterest_storage", "filterest_storage_deleted", "filterest_db_backups",
    "filterest_runtime", "filterest_postgres_data",
)


def installation_snapshot(checkout):
    """Include directory presence, file bytes/modes and the unchanged Git index.

    Git fetch's evidence (FETCH_HEAD) is outside application/operator state;
    HEAD and index are checked separately, with no lock/backup/key writes allowed.
    """
    result = {}
    for path in sorted(checkout.rglob("*")):
        relative = path.relative_to(checkout)
        if relative.parts[0] == ".git":
            continue
        result[str(relative)] = (stat.S_IMODE(path.lstat().st_mode),
                                path.read_bytes() if path.is_file() else None)
    result[".git/index"] = (checkout / ".git/index").read_bytes()
    result[".git/HEAD"] = (checkout / ".git/HEAD").read_bytes()
    return result


def assert_untouched(fixture, before):
    checkout = fixture["checkout"]
    assert installation_snapshot(checkout) == before
    assert git_output(checkout, "rev-parse", "HEAD") == fixture["old_commit"]
    assert update_backups(fixture) == []
    assert not (checkout / "data/runtime/filterest-update.lock").exists()
    forbidden = ("run_filterest_admin.sh", "ctl ", "install_filterest.sh", "pg_dump", "pg_restore", "docker stop", "docker up", "docker run")
    assert not [call for call in logged_calls(fixture) if call.startswith(forbidden)]


def revise_target(fixture, content):
    """Publish only inside the disposable local Git fixture, never the worktree."""
    checkout = fixture["checkout"]
    seed = checkout.parent / "seed"
    if content is None:
        subprocess.run(["git", "rm", CONTRACT], cwd=seed, check=True, capture_output=True)
    else:
        (seed / CONTRACT).write_bytes(content)
        subprocess.run(["git", "add", CONTRACT], cwd=seed, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "Target requirements"], cwd=seed, check=True, capture_output=True)
    subprocess.run(["git", "tag", "-f", "v8.51.0"], cwd=seed, check=True, capture_output=True)
    subprocess.run(["git", "push", "--force", "origin", "main", "--tags"], cwd=seed, check=True, capture_output=True)
    # Target evidence is already local, so the real updater's fetch need not
    # change even fixture refs while testing the no-installation-write guarantee.
    subprocess.run(["git", "fetch", "--force", "origin", "--tags"], cwd=checkout, check=True, capture_output=True)
    fixture["target_commit"] = git_output(seed, "rev-parse", "HEAD")


def package_probe(fixture, missing=""):
    checkout = fixture["checkout"]
    probe = checkout.parent / "bin/dpkg-query"
    probe.write_text('''#!/usr/bin/env bash
printf '%s\n' "${@: -1}" >> "$FILTEREST_TEST_LOG.packages"
if [[ "${@: -1}" == "${FILTEREST_TEST_MISSING_PACKAGE:-}" ]]; then
    printf 'deinstall ok config-files'
    exit 1
fi
printf 'install ok installed'
''')
    fixture["environment"]["FILTEREST_TEST_MISSING_PACKAGE"] = missing


def probed_packages(fixture):
    return Path(str(fixture["log"]) + ".packages").read_text().splitlines()


@pytest.mark.parametrize("missing", RUNTIME_PACKAGES)
def test_current_admin_package_refusal_is_before_any_installation_write(tmp_path, missing):
    fixture = build_update_fixture(tmp_path, "admin")
    package_probe(fixture, missing)
    before = installation_snapshot(fixture["checkout"])
    result = run_update(fixture, "--yes")
    assert result.returncode != 0 and GUIDANCE in result.stderr
    assert_untouched(fixture, before)


def test_target_added_admin_package_refuses_before_downtime(tmp_path):
    fixture = build_update_fixture(tmp_path, "admin")
    contract = (fixture["checkout"] / CONTRACT).read_bytes()
    revise_target(fixture, contract + b"common target-added-runtime\n")
    package_probe(fixture, "target-added-runtime")
    before = installation_snapshot(fixture["checkout"])
    result = run_update(fixture, "--yes")
    assert result.returncode != 0 and GUIDANCE in result.stderr
    assert "target-added-runtime" in probed_packages(fixture)
    assert_untouched(fixture, before)


@pytest.mark.parametrize("missing", ("", "openssl"))
def test_target_predating_contract_uses_installed_list(tmp_path, missing):
    fixture = build_update_fixture(tmp_path, "admin")
    revise_target(fixture, None)
    package_probe(fixture, missing)
    before = installation_snapshot(fixture["checkout"])
    result = run_update(fixture, "--yes")
    if missing:
        assert result.returncode != 0 and GUIDANCE in result.stderr
        assert_untouched(fixture, before)
    else:
        assert result.returncode == 0, result.stderr
        assert probed_packages(fixture) == list(RUNTIME_PACKAGES)
        assert git_output(fixture["checkout"], "rev-parse", "HEAD") == fixture["target_commit"]


@pytest.mark.parametrize("change,override,expected", (
    (b"common target-added-runtime\n", "", "target-added-runtime"),
    (b"", "17", "postgresql-17-pgvector"),
    (b"default-major", "", "postgresql-18-pgvector"),
    (b"remove-obsolete", "", "postgresql-16-pgvector"),
))
def test_prepared_admin_target_proceeds_with_the_target_package_contract(tmp_path, change, override, expected):
    fixture = build_update_fixture(tmp_path, "admin")
    content = (fixture["checkout"] / CONTRACT).read_bytes()
    if change == b"default-major":
        content = content.replace(b"postgresql-major 16", b"postgresql-major 18")
    elif change == b"remove-obsolete":
        content = content.replace(b"common curl\n", b"")
    else:
        content += change
    if content != (fixture["checkout"] / CONTRACT).read_bytes():
        revise_target(fixture, content)
    package_probe(fixture, "curl" if change == b"remove-obsolete" else "")
    result = run_update(fixture, "--yes", extra_environment={"FILTEREST_POSTGRESQL_MAJOR": override})
    assert result.returncode == 0, result.stderr
    packages = probed_packages(fixture)
    assert expected in packages
    assert "build-essential" not in packages and "python3-venv" not in packages
    assert git_output(fixture["checkout"], "rev-parse", "HEAD") == fixture["target_commit"]
    assert len(update_backups(fixture)) == 1
    assert_calls_in_order(logged_calls(fixture), ["run_filterest_admin.sh stop", "pg_dump", "install_filterest.sh --profile admin --yes --no-start", "run_filterest_admin.sh start", "filterest status"])


@pytest.mark.parametrize("override,missing", (("17", "postgresql-17-pgvector"), ("", "postgresql-18-pgvector")))
def test_target_postgresql_requirement_refuses_before_downtime(tmp_path, override, missing):
    fixture = build_update_fixture(tmp_path, "admin")
    if not override:
        content = (fixture["checkout"] / CONTRACT).read_bytes().replace(b"postgresql-major 16", b"postgresql-major 18")
        revise_target(fixture, content)
    package_probe(fixture, missing)
    before = installation_snapshot(fixture["checkout"])
    result = run_update(fixture, "--yes", extra_environment={"FILTEREST_POSTGRESQL_MAJOR": override})
    assert result.returncode != 0 and GUIDANCE in result.stderr
    assert_untouched(fixture, before)


@pytest.mark.parametrize("suffix", VOLUMES)
@pytest.mark.parametrize("marker", (False, True))
def test_docker_legacy_volume_check_is_before_writes_and_marker_allows_update(tmp_path, suffix, marker):
    fixture = build_update_fixture(tmp_path, "docker")
    checkout = fixture["checkout"]
    fake = checkout.parent / "bin/docker"
    old = "'volume inspect '*) exit 1 ;;"
    new = "'volume inspect '*) [[ \"${3:-}\" == \"$FILTEREST_TEST_LEGACY_VOLUME\" ]]; exit $? ;;"
    assert old in fake.read_text()
    fake.write_text(fake.read_text().replace(old, new))
    fixture["environment"]["FILTEREST_TEST_LEGACY_VOLUME"] = fixture["settings"]["COMPOSE_PROJECT_NAME"] + "_" + suffix
    if marker:
        (checkout / "config/docker-named-volume-migration-complete").write_text("completed by ordinary start\n")
    before = installation_snapshot(checkout)
    result = run_update(fixture, "--yes")
    if marker:
        assert result.returncode == 0, result.stderr
        assert git_output(checkout, "rev-parse", "HEAD") == fixture["target_commit"]
        assert len(update_backups(fixture)) == 1
        assert not [call for call in logged_calls(fixture) if call.startswith(("docker run", "docker volume inspect"))]
        assert_calls_in_order(logged_calls(fixture), ["docker stop app", "docker exec -T db sh -c", "docker up --build --detach", "docker ps"])
    else:
        assert result.returncode != 0 and VOLUME_GUIDANCE in result.stderr
        assert_untouched(fixture, before)
        # Exercise the requested runner preflight directly as well.
        direct = subprocess.run(["bash", str(checkout / "app/server_tools/run_filterest_docker.sh"), "update-preflight"], env=fixture["environment"], capture_output=True, text=True)
        assert direct.returncode != 0 and VOLUME_GUIDANCE in direct.stderr
        assert_untouched(fixture, before)


def test_direct_updater_preview_refusal_is_before_downtime(tmp_path):
    fixture = build_update_fixture(tmp_path, "admin")
    package_probe(fixture)
    before = installation_snapshot(fixture["checkout"])
    result = run_update(fixture, "--yes", extra_environment={"FILTEREST_AUTOMATED_PREVIEW_INITIAL_ADMIN": "1"})
    assert result.returncode != 0 and "Recovery refuses automated-preview credential file creation." in result.stderr
    assert_untouched(fixture, before)


@pytest.mark.parametrize("payload", (b"common $(touch executed)\n", b"common --evil\n", b"unknown openssl\n", b"postgresql-major 17\n"))
def test_target_contract_is_never_evaluated_and_invalid_data_refuses_early(tmp_path, payload):
    fixture = build_update_fixture(tmp_path, "admin")
    revise_target(fixture, (fixture["checkout"] / CONTRACT).read_bytes() + payload)
    package_probe(fixture)
    before = installation_snapshot(fixture["checkout"])
    result = run_update(fixture, "--yes")
    assert result.returncode != 0 and "invalid native host package requirements" in result.stderr
    assert not Path(str(fixture["log"]) + ".packages").exists()
    assert_untouched(fixture, before)


def test_target_contract_without_database_packages_refuses_before_downtime(tmp_path):
    fixture = build_update_fixture(tmp_path, "admin")
    revise_target(fixture, b"postgresql-major 16\ncommon openssl\n")
    package_probe(fixture)
    before = installation_snapshot(fixture["checkout"])
    result = run_update(fixture, "--yes")
    assert result.returncode != 0 and "invalid native host package requirements" in result.stderr
    assert_untouched(fixture, before)


@pytest.mark.parametrize("form", FORMS)
def test_target_package_bytes_are_scanned_before_staging(tmp_path, form):
    fixture = build_update_fixture(tmp_path, "admin")
    key_file = fixture["checkout"] / "keys/database_recovery.hmac.key"
    key_file.write_text(KEY.hex() + "\n")
    key_file.chmod(0o600)
    revise_target(fixture, (fixture["checkout"] / CONTRACT).read_bytes() + b"# " + FORMS[form] + b"\n")
    package_probe(fixture)
    before = installation_snapshot(fixture["checkout"])
    result = run_update(fixture, "--yes")
    assert result.returncode != 0
    assert not Path(str(fixture["log"]) + ".packages").exists()
    assert_untouched(fixture, before)


@pytest.mark.parametrize("recovery", (False, True))
@pytest.mark.parametrize("profile", ("admin", "development"))
def test_installer_package_list_preserves_ordinary_packages_and_recovery_defence(tmp_path, recovery, profile):
    log = tmp_path / "apt.log"
    environment = clean_filterest_environment(SOURCE_ROOT.parent)
    environment["FILTEREST_INSTALLER_LIBRARY_ONLY"] = "1"
    if recovery:
        environment["FILTEREST_RECOVERY_CONTENT_ROOT"] = str(SOURCE_ROOT.parent)
    script = '''
source "$1"
PROFILE="$2"
package_is_installed() { return 1; }
apt_has_package() { return 0; }
sudo() { printf '%s\n' "$*" >> "$3"; }
# Use a shell function, so no host package manager or privileged command runs.
run() { printf '%s\n' "$*" >> "$log"; }
log="$3"
install_host_packages
'''
    result = subprocess.run(["bash", "-c", script, "package-defence", str(SOURCE_ROOT / "server_tools/install_filterest.sh"), profile, str(log)], env=environment, capture_output=True, text=True)
    if recovery:
        assert result.returncode != 0 and GUIDANCE in result.stderr
        assert not log.exists()
    else:
        assert result.returncode == 0, result.stderr
        packages = [*RUNTIME_PACKAGES, *(["build-essential", "git", "xz-utils", "python3-venv"] if profile == "development" else [])]
        assert log.read_text().splitlines() == ["sudo -v", "sudo apt-get update", "sudo apt-get install -y " + " ".join(packages)]


def test_shared_volume_mappings_preserve_ordinary_paths_with_newlines(tmp_path):
    root = tmp_path / "ordinary-installation\nmultilingual-ä"
    root.mkdir()
    environment = dict(os.environ, FILTEREST_DOCKER_RUNNER_LIBRARY_ONLY="1", FILTEREST_RECOVERY_OUTPUT="0", FILTEREST_PROJECT_ROOT_OVERRIDE=str(root))
    script = '''
source "$1"
legacy_named_volume_mappings
'''
    result = subprocess.run(["bash", "-c", script, "mapping-test", str(SOURCE_ROOT / "server_tools/run_filterest_docker.sh")], env=environment, capture_output=True)
    assert result.returncode == 0, result.stderr
    expected = [f"{suffix}|{root}/{path}|{ownership}".encode() for suffix, path, ownership in (
        ("filterest_storage", "data/storage", "runtime"),
        ("filterest_storage_deleted", "data/storage_deleted", "runtime"),
        ("filterest_db_backups", "backups", "runtime"),
        ("filterest_runtime", "data/runtime", "runtime"),
        ("filterest_postgres_data", "data/postgres", "database"),
    )]
    assert result.stdout.split(b"\0") == [*expected, b""]
    assert list(root.iterdir()) == []
    (root / "config").mkdir()
    (root / "keys").mkdir()
    (root / "keys/docker.env").write_text("COMPOSE_PROJECT_NAME=ordinary\nFILTEREST_RUNTIME_UID=1000\nFILTEREST_RUNTIME_GID=1000\n")
    log = tmp_path / "ordinary-docker-arguments"
    script = '''
source "$1"
test_log="$2"
docker() {
    if [[ "$1 $2" == 'volume inspect' ]]; then [[ "$3" == ordinary_filterest_storage ]]; return; fi
    if [[ "$1" == run ]]; then printf '%s\\0' "$@" > "$test_log"; fi
    return 0
}
migrate_legacy_named_volumes
'''
    migrated = subprocess.run(["bash", "-c", script, "ordinary-migration", str(SOURCE_ROOT / "server_tools/run_filterest_docker.sh"), str(log)], env=environment, capture_output=True)
    assert migrated.returncode == 0, migrated.stderr
    assert f"{root}/data/storage:/installation".encode() in log.read_bytes().split(b"\0")
    assert (root / "config/docker-named-volume-migration-complete").read_text() == "migrated_from_project=ordinary\n"
