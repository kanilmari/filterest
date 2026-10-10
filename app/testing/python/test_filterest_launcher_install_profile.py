"""Verifies that ./filterest start, status and setup honour a Docker installation.
Bridges the root launcher, the shared installation-record rule and the Docker runner.
Exists so a Docker folder never falls through to the native installer, which would
install host packages and PostgreSQL, and so a folder recording both is refused.
Native lifecycle commands are recorders here; the fake Docker records its arguments.
"""

from __future__ import annotations

import os
import base64
import shlex
from pathlib import Path
import shutil
import subprocess

import pytest
from recovery_operator_input_probes import (FORMS, UTILITY_SITES,
    assert_utility_site, assert_scanner_invocation, signing_root, form_value, KEY)

from installation_fixture_files import LIFECYCLE_LIBRARY_FILES, RECOVERY_PSQL_FAKE
from recovery_lifecycle_output_probes import (
    test_lifecycle_dispatch_preserves_operator_failure_and_status,
    test_operator_streams_scan_returned_representations_and_preserve_status,
    test_operator_output_scanner_failure_withholds_both_streams,
    test_fast_external_capture_waits_for_its_scanner_under_nounset,
    test_legacy_import_scans_postgres_rows_and_errors,
    test_legacy_parser_uses_fixed_unknown_option_text,
    test_utility_filename_escapes_are_scanned_without_rewriting_the_cause,
    test_updater_validation_preserves_specific_explanation,
)


SOURCE_ROOT = Path(__file__).resolve().parents[2]

# The launchers, the real Docker runner, and the libraries they read at start.
COPIED_APP_FILES = (
    "filterest",
    "server_tools/run_filterest_docker.sh",
    "server_tools/lib/python_bytecode_cache.sh",
    "server_tools/lib/project_python_venv.sh",
    *LIFECYCLE_LIBRARY_FILES,
    ".env.example",
    "go.mod",
    "VERSION_APP",
    "VERSION_DB",
)

# Every native path the launcher can take ends in one of these.
NATIVE_RECORDERS = (
    "server_tools/install_filterest.sh",
    "server_tools/run_filterest_admin.sh",
    "ctl",
)

RECORD_CALL = (
    "#!/usr/bin/env bash\n"
    "printf '%s %s\\n' \"$(basename \"$0\")\" \"$*\" >> \"$FILTEREST_TEST_LOG\"\n"
)

RECORD_STATUS = (
    "import os, sys\n"
    "with open(os.environ['FILTEREST_TEST_LOG'], 'a', encoding='utf-8') as log:\n"
    "    log.write(' '.join(['dev_status.py', *sys.argv[1:]]) + '\\n')\n"
)

FAKE_DOCKER = (
    "#!/bin/sh\n"
    "printf 'docker %s\\n' \"$*\" >> \"$FILTEREST_TEST_LOG\"\n"
    "if [ \"${1:-}\" = compose ] && [ \"${2:-}\" = version ]; then printf '2.40.3\\n'; fi\n"
    # No earlier named volumes exist, so start migrates nothing.
    "if [ \"${1:-}\" = volume ] && [ \"${2:-}\" = inspect ]; then exit 1; fi\n"
    "case \"$*\" in *psql*) exec psql ;; esac\n"
    "exit 0\n"
)


def build_installation(tmp_path: Path) -> dict[str, Path]:
    """Create one standalone installation folder with recorders on every native path."""

    root = tmp_path / "filterest"
    app_root = root / "app"
    for relative_path in COPIED_APP_FILES:
        destination = app_root / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SOURCE_ROOT / relative_path, destination)
    shutil.copy2(SOURCE_ROOT.parent / "filterest", root / "filterest")
    shutil.copy2(SOURCE_ROOT.parent / "compose.yml", root / "compose.yml")
    (app_root / "docker").mkdir()
    (app_root / "docker/docker-compose.yml").write_text("services: {}\n", encoding="utf-8")
    for relative_path in NATIVE_RECORDERS:
        recorder = app_root / relative_path
        recorder.write_text(RECORD_CALL, encoding="utf-8")
        recorder.chmod(0o755)
    status_tool = app_root / "server_tools/agent_tools/dev_status.py"
    status_tool.parent.mkdir(parents=True)
    status_tool.write_text(RECORD_STATUS, encoding="utf-8")

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    (fake_bin / "psql").write_text(RECOVERY_PSQL_FAKE)
    (fake_bin / "psql").chmod(0o755)
    (fake_bin / "docker").write_text(FAKE_DOCKER, encoding="utf-8")
    (fake_bin / "docker").chmod(0o755)
    return {"root": root, "app": app_root, "bin": fake_bin, "log": tmp_path / "calls.log"}


def launcher_environment(installation: dict[str, Path]) -> dict[str, str]:
    environment = {
        name: value
        for name, value in os.environ.items()
        if not name.startswith(("FILTEREST_", "EASELECT_"))
        and name not in {"APP_PORT", "PORT", "PYTHONPYCACHEPREFIX"}
    }
    environment["PATH"] = f"{installation['bin']}:{environment['PATH']}"
    environment["FILTEREST_TEST_LOG"] = str(installation["log"])
    return environment


def run_filterest(
    installation: dict[str, Path],
    *arguments: str,
    environment: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(installation["root"] / "filterest"), *arguments],
        cwd=installation["root"],
        env=environment or launcher_environment(installation),
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )


def calls(installation: dict[str, Path]) -> list[str]:
    log = installation["log"]
    return log.read_text(encoding="utf-8").splitlines() if log.exists() else []


def set_up_docker(installation: dict[str, Path]) -> None:
    environment = launcher_environment(installation)
    environment["FILTEREST_PROJECT_ROOT_OVERRIDE"] = str(installation["root"])
    subprocess.run(
        ["bash", str(installation["app"] / "server_tools/run_filterest_docker.sh"), "setup"],
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    installation["log"].unlink(missing_ok=True)


def native_settings(installation: dict[str, Path], name: str) -> Path:
    return installation["root"] / "keys/filterest_runtime" / name


def write_native_settings(installation: dict[str, Path], name: str, text: str) -> Path:
    settings = native_settings(installation, name)
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(text, encoding="utf-8")
    settings.chmod(0o600)
    return settings


def setup_marker(installation: dict[str, Path]) -> Path:
    return installation["root"] / "data/runtime/filterest-setup-complete"


def write_setup_marker(installation: dict[str, Path], profile: str) -> Path:
    marker = setup_marker(installation)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(
        f"profile={profile}\napp_version=8.50.0\ndb_version=9.0.0\n", encoding="utf-8"
    )
    return marker


def native_calls(installation: dict[str, Path]) -> list[str]:
    return [
        call
        for call in calls(installation)
        if call.startswith(("install_filterest.sh", "run_filterest_admin.sh", "ctl", "dev_status.py"))
    ]


def docker_calls(installation: dict[str, Path]) -> list[str]:
    return [call for call in calls(installation) if call.startswith("docker")]


def test_start_and_status_run_the_docker_stack_of_a_docker_installation(
    tmp_path: Path,
) -> None:
    installation = build_installation(tmp_path)
    set_up_docker(installation)
    root = installation["root"]
    compose = (
        f"docker compose --project-directory {root} --file {root / 'compose.yml'} "
        f"--env-file {root / 'keys/docker.env'}"
    )

    started = run_filterest(installation, "start")
    status = run_filterest(installation, "status")

    assert started.returncode == 0, started.stderr
    assert status.returncode == 0, status.stderr
    assert f"{compose} up --build --detach --wait" in calls(installation)
    assert f"{compose} ps" in calls(installation)
    assert "Welcome to Filterest" not in started.stdout
    assert native_calls(installation) == []


@pytest.mark.parametrize(
    ("arguments", "advice"),
    (
        (("setup",), "./filterest docker setup"),
        (("setup", "--profile", "admin", "--yes"), "./filterest docker setup"),
        (("ctl", "--stop"), "./filterest docker stop"),
        (("start", "--stop"), "./filterest docker stop"),
    ),
)
def test_native_only_commands_refuse_a_docker_installation_with_its_command(
    tmp_path: Path, arguments: tuple[str, ...], advice: str
) -> None:
    installation = build_installation(tmp_path)
    set_up_docker(installation)

    refused = run_filterest(installation, *arguments)

    assert refused.returncode == 2
    assert "this installation runs in Docker" in refused.stderr
    assert advice in refused.stderr
    assert calls(installation) == []


@pytest.mark.parametrize(
    "native_record",
    ("marker", "empty-marker", "broken-marker-link", "development-settings", "runtime-settings"),
)
@pytest.mark.parametrize("command", ("start", "status", "setup"))
def test_a_folder_recording_docker_and_native_installations_is_refused(
    tmp_path: Path, native_record: str, command: str
) -> None:
    installation = build_installation(tmp_path)
    set_up_docker(installation)
    if native_record == "marker":
        record = write_setup_marker(installation, "admin")
    elif native_record == "empty-marker":
        record = setup_marker(installation)
        record.parent.mkdir(parents=True, exist_ok=True)
        record.write_text("", encoding="utf-8")
    elif native_record == "broken-marker-link":
        record = setup_marker(installation)
        record.parent.mkdir(parents=True, exist_ok=True)
        record.symlink_to(tmp_path / "missing-marker")
    elif native_record == "development-settings":
        record = write_native_settings(
            installation,
            "development_environment.env",
            "FILTEREST_INSTALL_PROFILE=development\nDB_PASSWORD=native-only-secret\n",
        )
    else:
        # The Docker runner writes this file too; only a profile makes it native.
        record = native_settings(installation, "runtime_environment.env")
        record.write_text(
            record.read_text(encoding="utf-8") + "FILTEREST_INSTALL_PROFILE=admin\n",
            encoding="utf-8",
        )

    refused = run_filterest(installation, command)

    assert refused.returncode != 0
    assert "records both a Docker installation (keys/docker.env)" in refused.stderr
    # These ordinary commands retain 3d11b6b's record-path guidance. Recovery
    # commands separately assert that no key-bearing record path is printed.
    assert str(record) in refused.stderr
    assert "native-only-secret" not in refused.stderr
    assert calls(installation) == []


def test_docker_settings_runtime_file_alone_is_not_a_native_record(tmp_path: Path) -> None:
    installation = build_installation(tmp_path)
    set_up_docker(installation)
    assert native_settings(installation, "runtime_environment.env").is_file()

    started = run_filterest(installation, "start")

    assert started.returncode == 0, started.stderr
    assert native_calls(installation) == []


def test_restore_command_routes_a_legacy_backup_through_docker(tmp_path: Path) -> None:
    installation = build_installation(tmp_path)
    set_up_docker(installation)
    backup = installation["root"] / "backups/update_legacy"
    backup.mkdir(mode=0o700)
    (backup / "database.dump").write_bytes(b"PGDMP legacy fixture")
    (backup / "database.dump").chmod(0o600)
    (backup / "manifest.txt").write_text("profile=docker\n")
    (backup / "manifest.txt").chmod(0o600)

    restored = run_filterest(installation, "restore-database", "--backup", str(backup), "--yes", "--legacy")

    assert restored.returncode == 0, restored.stderr
    assert "Legacy backup" in restored.stdout
    assert any("stop app" in call for call in docker_calls(installation))
    assert any("pg_restore --exit-on-error --single-transaction --no-owner" in call
               for call in docker_calls(installation))
    assert native_calls(installation) == []


@pytest.mark.parametrize("damage", ("symbolic-link", "directory"))
@pytest.mark.parametrize("command", ("start", "setup", "status"))
def test_unreadable_docker_settings_stop_the_command_instead_of_installing(
    tmp_path: Path, damage: str, command: str
) -> None:
    installation = build_installation(tmp_path)
    settings = installation["root"] / "keys/docker.env"
    settings.parent.mkdir(parents=True)
    if damage == "symbolic-link":
        target = tmp_path / "elsewhere.env"
        target.write_text("FILTEREST_INSTALL_PROFILE=docker\n", encoding="utf-8")
        settings.symlink_to(target)
    else:
        settings.mkdir()

    refused = run_filterest(installation, command)

    assert refused.returncode != 0
    assert "Docker settings path must be a regular file" in refused.stderr
    assert calls(installation) == []


def test_native_installations_keep_their_native_commands(tmp_path: Path) -> None:
    installation = build_installation(tmp_path)
    write_native_settings(
        installation, "development_environment.env", "FILTEREST_INSTALL_PROFILE=admin\n"
    )
    write_setup_marker(installation, "admin")

    started = run_filterest(installation, "start")
    status = run_filterest(installation, "status")
    setup = run_filterest(installation, "setup", "--dry-run")

    assert started.returncode == 0, started.stderr
    assert status.returncode == 0, status.stderr
    assert setup.returncode == 0, setup.stderr
    assert calls(installation) == [
        "run_filterest_admin.sh ",
        "dev_status.py",
        "install_filterest.sh --dry-run",
    ]


@pytest.mark.parametrize(
    ("settings_profile", "marker_profile", "expected_setup"),
    (
        # Settings written, setup interrupted before its completion marker.
        ("development", None, "install_filterest.sh --profile development"),
        # A marker without the settings profile resumes the marker's profile.
        (None, "admin", "install_filterest.sh --profile admin"),
    ),
)
def test_an_unfinished_native_installation_resumes_its_setup(
    tmp_path: Path,
    settings_profile: str | None,
    marker_profile: str | None,
    expected_setup: str,
) -> None:
    installation = build_installation(tmp_path)
    if settings_profile:
        write_native_settings(
            installation,
            "development_environment.env",
            f"FILTEREST_INSTALL_PROFILE={settings_profile}\n",
        )
    if marker_profile:
        write_setup_marker(installation, marker_profile)

    started = run_filterest(installation, "start")

    assert started.returncode == 0, started.stderr
    assert "Welcome to Filterest" in started.stdout
    assert calls(installation) == [expected_setup]


def test_embedded_easelect_root_without_docker_settings_stays_native(tmp_path: Path) -> None:
    installation = build_installation(tmp_path)
    easelect_root = tmp_path / "easelect"
    (easelect_root / ".git").mkdir(parents=True)
    (easelect_root / "VERSION_EASELECT").write_text("9.3.19\n", encoding="utf-8")
    # The composition's own source list, which the shared path resolver requires.
    (easelect_root / "filterest.source-roots").write_text("filterest_private\n", encoding="utf-8")
    (easelect_root / "filterest.source-roots").chmod(0o644)
    environment = launcher_environment(installation)
    environment["FILTEREST_PROJECT_ROOT_OVERRIDE"] = str(easelect_root)

    status = subprocess.run(
        [str(installation["app"] / "filterest"), "status"],
        cwd=installation["app"],
        env=environment,
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert status.returncode == 0, status.stderr
    assert calls(installation) == ["dev_status.py"]
    assert not (easelect_root / "keys/docker.env").exists()


# Execute the actual output statements as well as the vulnerable callable paths.
# Later sites cannot normally receive key-bearing paths because packet creation
# refuses them earlier; the isolated statements cover that defensive boundary.
RECOVERY_MESSAGE_SITES = (
    ('runner', 'dump-folder', 'DUMP_OUTPUT="$PROBE/missing/database.dump"; dump_database'),
    ('runner', 'dump-target', 'mkdir -p "$PROBE"; touch "$PROBE/database.dump"; DUMP_OUTPUT="$PROBE/database.dump"; dump_database'),
    ('runner', 'dump-dryrun', 'mkdir -p "$PROBE"; DUMP_OUTPUT="$PROBE/database.dump"; DRY_RUN=1; dump_database'),
    ('runner', 'restore-dryrun', 'RESTORE_BACKUP="$PROBE"; RESTORE_YES=1; DRY_RUN=1; restore_database'),
    ('runner', 'refusal', 'die "Refused recovery packet: $PROBE"'),
    ('runner', 'quoted-dryrun', 'DRY_RUN=1; run restore-tool "$PROBE"'),
    ('runner', 'setup-dryrun', '  [dry-run] prepare protected directories'),
    ('runner', 'settings-ready', '✓ Protected Docker settings are ready:'),
    ('runner', 'legacy-volume', 'Migrating retained Docker volume'),
    ('runner', 'readiness-dryrun', '  [dry-run] wait for'),
    ('runner', 'readiness-wait', 'Waiting up to'),
    ('runner', 'readiness-success', 'is ready and its database schema'),
    ('runner', 'browser-ready', 'Filterest is ready: %s/first-run'),
    ('runner', 'stop-location', 'Raw PostgreSQL data may be copied'),
    ('runner', 'profile', 'main profile'),
    ('updater', 'refusal', 'die "Refused backup folder: $PROBE"'),
    ('updater', 'cleanup', 'RECOVERY_HINT="Recover from $PROBE"; exit 1'),
    ('updater', 'mutable-release-paths', 'Refusing release commit with tracked mutable'),
    ('updater', 'plan', '  Repository: %s'),
    ('updater', 'backup-created', 'Backup created: %s'),
    ('updater', 'completed', 'Filterest update completed: %s'),
    ('updater', 'folder-tool-error', 'printf x > "$PROBE"; BACKUP_ROOT="$PROBE/child"; prepare_backup_directory'),
    ('updater', 'lock-tool-error', 'printf x > "$PROBE"; RUNTIME_ROOT="$PROBE/child"; acquire_update_lock'),
)


@pytest.mark.parametrize('representation', ['raw', 'hex', 'base64', 'urlsafe', 'embedded-base64'])
@pytest.mark.parametrize('script_name,site,command', RECOVERY_MESSAGE_SITES, ids=[row[1] for row in RECOVERY_MESSAGE_SITES])
def test_every_recovery_shell_message_redacts_key_bearing_paths(tmp_path, representation, script_name, site, command):
    key = b'\xfb\xff' + b'A' * 30
    forms = {'raw': os.fsdecode(key), 'hex': key.hex().upper(),
             'base64': base64.b64encode(key).decode(), 'urlsafe': base64.urlsafe_b64encode(key).decode(),
             'embedded-base64': base64.b64encode(b'X' + key + b'after').decode()}
    root = tmp_path / 'installation'
    (root / 'keys').mkdir(parents=True)
    signing_key = root / 'keys/database_recovery.hmac.key'
    signing_key.write_text(key.hex() + '\n')
    signing_key.chmod(0o600)
    probe = root / ('prefix-' + forms[representation] + '-suffix')
    probe.parent.mkdir(parents=True, exist_ok=True)
    script = SOURCE_ROOT / ('server_tools/run_filterest_docker.sh' if script_name == 'runner' else 'server_tools/update_filterest.sh')
    source = script.read_text()
    # bash -c has no script filename; keep the real script's library resolution.
    source = source.replace('"${BASH_SOURCE[0]}"', shlex.quote(str(script)))
    if script_name == 'updater':
        source = source.rsplit('\nmain "$@"', 1)[0]
    if '\n' not in command and not any(word in command for word in ('; ', 'die ', 'main ')):
        lines = source.splitlines()
        start = next(i for i, line in enumerate(lines) if 'filterest_recovery_diagnostic' in line and command in line)
        end = start
        while lines[end].endswith('\\'):
            end += 1
        command = '\n'.join(lines[start:end + 1])
    # Every dynamic slot of the actual message gets an operator-supplied path.
    slots = ('ENV_FILE', 'volume_name', 'destination', 'scheme', 'port', 'EXPECTED_VERSION',
             'READY_TIMEOUT_SECONDS', 'browser_url', 'mutable_tracked_paths', 'RELEASE_REPOSITORY', 'current_version',
             'TARGET_VERSION', 'TARGET_COMMIT', 'PROFILE', 'backup_dir')
    assignments = '\n'.join(name + '="$PROBE"' for name in slots)
    if site == 'profile':
        command = 'printf "FILTEREST_INSTALL_PROFILE=%s\\n" "$PROBE" > "$ENV_FILE"; main profile'
    if site == 'stop-location':
        command = 'mkdir -p "$PROBE"; ln -s "$REAL_ROOT/keys" "$PROBE/keys"; PROJECT_ROOT="$PROBE"; ' + command
    result = subprocess.run(['bash', '-c', source + '\n' + assignments + '\n' + command],
        env=dict(os.environ, FILTEREST_PROJECT_ROOT_OVERRIDE=str(root), FILTEREST_ROOT=str(root),
                 FILTEREST_DOCKER_RUNNER_LIBRARY_ONLY='1', PROBE=str(probe), REAL_ROOT=str(root)), capture_output=True)
    output = result.stdout + result.stderr
    assert key not in output and forms[representation].encode('utf-8', errors='surrogateescape') not in output
    assert b'redacted:' in output or (site == 'profile' and output == b'\n') or \
        (site in ('folder-tool-error', 'lock-tool-error') and b'Recovery content refused;' in output), (site, output)
    assert b'Traceback' not in output


@pytest.mark.parametrize('command', ['restore-database', 'verify-update-backup', 'extract-update-backup'])
def test_recovery_launcher_mixed_profile_refusal_omits_key_bearing_record_paths(tmp_path, command):
    key = b'E' * 32
    installation = build_installation(tmp_path / key.hex())
    root = installation['root']
    write_native_settings(installation, 'runtime_environment.env', 'FILTEREST_INSTALL_PROFILE=development\n')
    (root / 'keys/database_recovery.hmac.key').write_text(key.hex() + '\n')
    (root / 'keys/database_recovery.hmac.key').chmod(0o600)
    (root / 'keys/docker.env').write_text('FILTEREST_INSTALL_PROFILE=docker\n')
    result = run_filterest(installation, command)
    assert result.returncode and 'records both' in result.stderr
    assert key.hex() not in result.stdout + result.stderr and calls(installation) == []


def test_recovery_shell_scanner_failure_withholds_original_message(tmp_path):
    library = SOURCE_ROOT / 'server_tools/lib/installation_records.sh'
    environment = dict(os.environ, PATH=str(tmp_path))  # Python is deliberately unavailable.
    result = subprocess.run(['/bin/bash', '-c', 'source "$1"; filterest_recovery_diagnostic "$2" "%s\\n" "$3"',
        'probe', str(library), str(tmp_path), 'sensitive-key-bearing-path'], env=environment, capture_output=True, text=True)
    assert result.returncode == 0 and not result.stdout
    assert result.stderr == 'Recovery diagnostic unavailable; sensitive details withheld.\n'
    assert 'sensitive-key-bearing-path' not in result.stdout + result.stderr


@pytest.mark.parametrize('missing', ['filterest', 'go.mod', 'VERSION_APP'])
def test_recovery_root_launcher_omits_paths_when_application_is_incomplete(tmp_path, missing):
    installation = build_installation(tmp_path / ('E7-key-' + 'ab' * 32))
    (installation['app'] / missing).unlink()
    result = run_filterest(installation, 'restore-database')
    assert result.returncode and 'is missing' in result.stderr
    assert 'ab' * 32 not in result.stdout + result.stderr and calls(installation) == []


@pytest.mark.parametrize('command', ['restore-database', 'verify-update-backup', 'extract-update-backup'])
def test_recovery_launcher_redacts_resolver_error_paths(tmp_path, command):
    key = b'\xab' * 32
    installation = build_installation(tmp_path / key.hex())
    (installation['root'] / 'keys').mkdir()
    path = installation['root'] / 'keys/database_recovery.hmac.key'
    path.write_text(key.hex() + '\n')
    path.chmod(0o600)
    (installation['app'] / 'server_tools/lib/filterest_paths.py').unlink()
    result = run_filterest(installation, command)
    assert result.returncode and 'path resolver is missing' in result.stderr
    assert 'redacted:' in result.stderr and key.hex() not in result.stdout + result.stderr
    assert calls(installation) == []


@pytest.mark.parametrize('representation', FORMS[:5])
@pytest.mark.parametrize('site', UTILITY_SITES, ids=[f'{row[0]}:{row[1]}' for row in UTILITY_SITES])
def test_recovery_utility_failures_scan_errors_without_losing_explanations(tmp_path, site, representation):
    assert_utility_site(tmp_path, site, representation)


@pytest.mark.parametrize('representation', FORMS[:5])
@pytest.mark.parametrize('failed', [False, True])
def test_shell_scanner_receives_no_operator_values_in_argv_or_environment(tmp_path, representation, failed):
    assert_scanner_invocation(tmp_path, representation, failed)


@pytest.mark.parametrize('representation', FORMS[:5])
@pytest.mark.parametrize('failed', [False, True])
def test_dump_dirname_uses_terminator_and_suppresses_utility_error(tmp_path, representation, failed):
    root = signing_root(tmp_path / 'installation')
    value = form_value(representation)
    source_file = SOURCE_ROOT / 'server_tools/run_filterest_docker.sh'
    source = source_file.read_text().replace('"${BASH_SOURCE[0]}"', shlex.quote(str(source_file)))
    (root / Path('--' + value).parent).mkdir(parents=True, exist_ok=True)
    command = 'DUMP_OUTPUT="$PROBE"; DRY_RUN=1; dump_database'
    if failed:
        command = 'dirname() { printf "UNFILTERED: %s\\n" "$*" >&2; return 23; }; ' + command
    result = subprocess.run(['bash', '-c', source + '\n' + command], cwd=root, capture_output=True,
        env=dict(os.environ, FILTEREST_PROJECT_ROOT_OVERRIDE=str(root),
                 FILTEREST_DOCKER_RUNNER_LIBRARY_ONLY='1', PROBE='--' + value))
    output = result.stdout + result.stderr
    assert result.returncode == (1 if failed else 0), output
    assert KEY not in output and value.encode('utf-8', errors='surrogateescape') not in output
    assert b'UNFILTERED' not in output and b'redacted:' in output


@pytest.mark.parametrize('mode', ['missing', 'invalid-import', 'syntax'])
def test_recovery_python_startup_never_prints_path_tracebacks(tmp_path, mode):
    root = signing_root(tmp_path / 'installation')
    script = root / (KEY.hex().upper() + '.py')
    if mode != 'missing':
        script.write_text('import deliberately_missing_recovery_library\n' if mode == 'invalid-import' else 'syntax error !\n')
    library = SOURCE_ROOT / 'server_tools/lib/installation_records.sh'
    result = subprocess.run(['bash', '-c', 'source "$1"; filterest_recovery_python "$2" python3 "$3"',
        'probe', str(library), str(root), str(script)], capture_output=True)
    assert result.returncode == 1 and not result.stdout
    assert result.stderr == b'Recovery entrypoint unavailable; sensitive details withheld.\n'


@pytest.mark.parametrize('script', ['server_tools/update_filterest.sh', 'server_tools/run_filterest_docker.sh'])
def test_recovery_initial_root_discovery_failure_is_fixed_text(tmp_path, script):
    value = KEY.hex().upper()
    arguments = ['dump-database', '--help'] if script.endswith('run_filterest_docker.sh') else ['--help']
    result = subprocess.run([str(SOURCE_ROOT / script), *arguments], capture_output=True,
        env=dict(os.environ, FILTEREST_ROOT=str(tmp_path / value), FILTEREST_PROJECT_ROOT_OVERRIDE=str(tmp_path / value), FILTEREST_DOCKER_RUNNER_LIBRARY_ONLY='0'))
    assert result.returncode == 1 and not result.stdout
    assert result.stderr == b'Recovery installation root unavailable; sensitive details withheld.\n'


@pytest.mark.parametrize('representation', FORMS[:5])
@pytest.mark.parametrize('script', ['filterest', 'app/filterest', 'app/server_tools/run_filterest_docker.sh',
    'app/server_tools/update_filterest.sh', 'app/server_tools/setup_local_dev_environment.sh'])
def test_each_launcher_checks_dirname_status_and_suppresses_stderr(tmp_path, representation, script):
    value = form_value(representation)
    copied = tmp_path / ('--' + value + '.sh')
    copied.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE_ROOT.parent / script, copied)
    commands = tmp_path / 'bin'
    commands.mkdir()
    stub = commands / 'dirname'
    stub.write_text('#!/bin/bash\nprintf "UNFILTERED: %s\\n" "$*" >&2\nexit 23\n')
    stub.chmod(0o700)
    # Recovery location closures apply to recovery dispatch, including help for
    # those actions. Ordinary help retains the original launcher's diagnostics.
    if script.endswith('run_filterest_docker.sh'):
        arguments = ['dump-database', '--help']
    elif script in ('filterest', 'app/filterest'):
        arguments = ['update', '--help']
    else:
        arguments = ['--help']
    result = subprocess.run(['/bin/bash', str(copied), *arguments], capture_output=True,
        env=dict(os.environ, PATH=str(commands) + ':' + os.environ['PATH']))
    assert result.returncode == 1 and not result.stdout
    assert result.stderr == b'Recovery launcher location unavailable; sensitive details withheld.\n'


@pytest.mark.parametrize('representation', FORMS[:5])
@pytest.mark.parametrize('utility', ['mkdir', 'chmod'])
def test_directory_preparation_preserves_scanned_utility_explanations(tmp_path, representation, utility):
    root = signing_root(tmp_path / 'installation')
    value = form_value(representation)
    probe = root / ('--' + value)
    if utility == 'chmod':
        probe.mkdir(parents=True)
    source_file = SOURCE_ROOT / 'server_tools/run_filterest_docker.sh'
    source = source_file.read_text().replace('"${BASH_SOURCE[0]}"', shlex.quote(str(source_file)))
    command = utility + '() { printf "UNFILTERED: %s\\n" "$*" >&2; return 23; }; prepare_directory "$PROBE" 700'
    result = subprocess.run(['bash', '-c', source + '\n' + command], capture_output=True,
        env=dict(os.environ, FILTEREST_PROJECT_ROOT_OVERRIDE=str(root),
            FILTEREST_DOCKER_RUNNER_LIBRARY_ONLY='1', PROBE=str(probe)))
    output = result.stdout + result.stderr
    assert result.returncode == 1
    if b'Recovery content refused;' in output:
        # Artifact names are rejected before the mocked utility is dispatched.
        assert b'UNFILTERED:' not in output
    else:
        assert b'redacted:' in output and b'UNFILTERED:' in output
    assert KEY not in output and value.encode('utf-8', errors='surrogateescape') not in output


@pytest.mark.parametrize('representation', FORMS[:5])
def test_record_grep_errors_are_scanned_and_keep_discovery_closed(tmp_path, representation):
    root = signing_root(tmp_path / 'installation')
    probe = root / ('--' + form_value(representation))
    probe.parent.mkdir(parents=True, exist_ok=True)
    probe.touch()
    library = SOURCE_ROOT / 'server_tools/lib/installation_records.sh'
    shell = 'source "$1"; grep() { printf "UNFILTERED: %s\\n" "$*" >&2; return 2; }; PROJECT_ROOT="$2"; filterest_native_setup_records "$2/missing" "$3"'
    result = subprocess.run(['bash', '-c', shell, 'probe', str(library), str(root), str(probe)], capture_output=True)
    output = result.stdout + result.stderr
    assert result.returncode == 2 and not result.stdout and b'redacted:' in result.stderr
    assert b'UNFILTERED:' in output and KEY not in output
    assert form_value(representation).encode('utf-8', errors='surrogateescape') not in output


@pytest.mark.parametrize('representation', FORMS[:5])
@pytest.mark.parametrize('kind', ['invalid-subnet', 'missing-inventory', 'folder-ownership'])
def test_network_recovery_prerequisite_prints_only_scanned_original_values(tmp_path, representation, kind):
    import json
    root = signing_root(tmp_path / 'installation')
    value = form_value(representation)
    arguments = ['--recovery-root', str(root), '--subnet', 'prefix-' + value]
    if kind != 'invalid-subnet':
        arguments = ['--recovery-root', str(root), '--networks', str(root / ('missing-' + value)), '--expected-networks', '1']
    if kind == 'folder-ownership':
        inventory = root / 'inventory.json'
        inventory.write_text(json.dumps([{'Labels': {'com.docker.compose.project': 'prefix-' + value,
            'com.docker.compose.project.working_dir': str(root / ('other-' + value))}}]))
        arguments = ['--recovery-root', str(root), '--project', 'prefix-' + value, '--working-directory', str(root),
            '--networks', str(inventory), '--expected-networks', '1', '--containers', str(inventory), '--expected-containers', '1']
    library = SOURCE_ROOT / 'server_tools/lib/installation_records.sh'
    helper = SOURCE_ROOT / 'server_tools/lib/docker_network_validator.py'
    result = subprocess.run(['bash', '-c', 'source "$1"; shift; filterest_recovery_python "$@"', 'probe',
        str(library), str(root), 'python3', str(helper), *arguments], capture_output=True)
    output = result.stdout + result.stderr
    assert result.returncode == 1 and not result.stdout and b'Traceback' not in output
    assert KEY not in output and value.encode('utf-8', errors='surrogateescape') not in output
    assert b'redacted:' in output if kind != 'invalid-subnet' else b'canonical IPv4 CIDR' in output
