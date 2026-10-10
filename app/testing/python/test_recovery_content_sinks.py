"""test_recovery_content_sinks.py: transferable bytes at shell recovery sinks.

Connect real dump/backup-all writers, settings copies and restore SQL staging.
Synthetic transports exercise all packet representations and stream boundaries.
No installed database, network or Docker daemon is opened by these tests.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import os
from pathlib import Path
import shlex
import subprocess
import sys
import shutil
import zipfile
import signal
import time

import pytest
from test_recovery_synchronous_diagnostics import copy_launchers

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "app"
LIBRARY = SOURCE / "server_tools/lib/installation_records.sh"
KEY = hashlib.sha256(b"synthetic E15 content refusal key").digest()


def forms(key=KEY):
    result = {"raw": key}
    hexadecimal = key.hex()
    for case, text in (("lower", hexadecimal), ("upper", hexadecimal.upper()),
                       ("mixed", "".join(c.upper() if i % 2 else c for i, c in enumerate(hexadecimal)))):
        result["hex-" + case] = text.encode()
        for codec in ("utf-16le", "utf-16be"):
            result[codec + "-" + case] = text.encode(codec)
    for name, encode in (("standard", base64.b64encode), ("urlsafe", base64.urlsafe_b64encode)):
        for alignment in range(3):
            value = encode(b"Q" * alignment + key)
            result[f"{name}-{alignment}-padded"] = value
            result[f"{name}-{alignment}-unpadded"] = value.rstrip(b"=")
    return result


FORMS = forms()


def installation(tmp_path, payload=b"SELECT 42;\n"):
    root = tmp_path / "installation"
    (root / "keys").mkdir(parents=True, mode=0o700)
    key = root / "keys/database_recovery.hmac.key"
    key.write_text(KEY.hex() + "\n")
    key.chmod(0o600)
    (root / "instances/proof/backups").mkdir(parents=True)
    (root / "instances/proof/.env").write_text("DB_ADMIN_USER=admin\nDB_NAME=site\n")
    (root / "row.bin").write_bytes(payload)
    return root


def shell(root, script, *args, input=None, source=LIBRARY):
    environment = dict(os.environ, PROJECT_ROOT=str(root), FILTEREST_RECOVERY_OUTPUT="1",
                       FILTEREST_SOURCE_ROOT=str(SOURCE), PYTHONDONTWRITEBYTECODE="1")
    return subprocess.run(["/bin/bash", "-c", 'source "$1"; shift; ' + script,
                           "probe", str(source), *map(str, args)], cwd=root, env=environment,
                          input=input, capture_output=True, timeout=45)


BACKUP_PROBE = '''
source "$1/server_tools/ctl/lib/instance_backup.sh"
source "$1/server_tools/ctl/lib/instance_mass.sh"
project_default_db_name() { printf site; }
load_instance_backup_policy_flags() { eval "$4=()"; }
append_default_instance_backup_exclusions() { :; }
date() { printf '20300102_030405\n'; }
docker() {
    if [[ "$1" == ps ]]; then printf 'easelect-proof-db\n';
    elif [[ "$*" == *pg_dump* ]]; then cat row.bin; return "${PRODUCER_STATUS:-0}";
    else printf '%s' "${TOOL_CONTENT:-}"; fi
}
case "$2" in single) backup_instance proof ;; all) backup_all_instances ;; writer)
write_instance_database_backup proof instances/proof/backups/backup_20300102_030405.sql.gz admin site ;; esac
'''


@pytest.mark.parametrize("route", ("single", "all"))
@pytest.mark.parametrize("form", FORMS)
@pytest.mark.parametrize("boundary", (0, 65536, 131072))
def test_database_rows_are_refused_before_a_backup_is_published(tmp_path, route, form, boundary):
    value = FORMS[form]
    prefix = max(0, boundary - len(value) // 2)
    root = installation(tmp_path, b"." * prefix + value + b"\n")
    result = shell(root, BACKUP_PROBE, SOURCE, route)
    assert result.returncode != 0, (route, form, result.stdout, result.stderr)
    assert not list((root / "instances/proof/backups").iterdir())
    assert KEY.hex().encode() not in result.stdout + result.stderr


@pytest.mark.parametrize("route", ("single", "all", "writer"))
@pytest.mark.parametrize("failure", ("content", "producer", "compressor", "scanner", "permission"))
def test_failed_run_preserves_preexisting_backup_and_removes_owned_partial(tmp_path, route, failure):
    root = installation(tmp_path, FORMS["hex-lower"] if failure == "content" else b"SELECT 42;\n")
    target = root / "instances/proof/backups/backup_20300102_030405.sql.gz"
    target.write_bytes(b"pre-existing file")
    target.chmod(0o640)
    script = BACKUP_PROBE
    if failure == "producer":
        script = 'PRODUCER_STATUS=23\n' + script
    elif failure == "compressor":
        script = 'gzip() { cat >/dev/null; return 29; };\n' + script
    elif failure == "scanner":
        script = script.replace('case "$2"', 'filterest_recovery_content_stream() { return 31; };\ncase "$2"')
    elif failure == "permission":
        script = 'chmod() { return 33; };\n' + script
    result = shell(root, script, SOURCE, route)
    assert result.returncode != 0
    if route == "writer" and failure in ("producer", "compressor", "permission"):
        assert result.returncode == {"producer": 23, "compressor": 29, "permission": 33}[failure]
    assert target.read_bytes() == b"pre-existing file"
    assert target.stat().st_mode & 0o777 == 0o640
    assert list(target.parent.iterdir()) == [target]


@pytest.mark.parametrize("route", ("single", "all", "writer"))
def test_safe_run_never_replaces_preexisting_backup(tmp_path, route):
    root = installation(tmp_path)
    target = root / "instances/proof/backups/backup_20300102_030405.sql.gz"
    target.write_bytes(b"pre-existing backup")
    result = shell(root, BACKUP_PROBE, SOURCE, route)
    assert result.returncode != 0
    assert target.read_bytes() == b"pre-existing backup"
    assert list(target.parent.iterdir()) == [target]


def baseline_writer():
    baseline = os.environ.get("FILTEREST_E15_BASELINE_ROOT")
    if baseline:
        content = (Path(baseline) / "app/server_tools/ctl/lib/instance_backup.sh").read_text()
    else:
        content = subprocess.check_output(["git", "show", "731a3c5:app/server_tools/ctl/lib/instance_backup.sh"], cwd=ROOT).decode()
    start = content.index("write_instance_database_backup() {")
    return content[start:content.index("\n}\n", start) + 3]


@pytest.mark.parametrize("route", ("single", "all"))
def test_safe_backup_matches_731a3c5_byte_for_byte(tmp_path, route):
    payload = (b"COPY public.payload (value) FROM stdin;\n" + b"ordinary multilingual: Helsinki, Turku\n" * 100000 + b"\\.\n")
    root = installation(tmp_path, payload)
    target = root / "instances/proof/backups/backup_20300102_030405.sql.gz"
    result = shell(root, BACKUP_PROBE, SOURCE, route)
    assert result.returncode == 0, result.stdout + result.stderr
    changed = target.read_bytes()
    target.unlink()
    script = BACKUP_PROBE[:BACKUP_PROBE.index('case "$2"')]
    script += baseline_writer() + '\nwrite_instance_database_backup proof "$2" admin site'
    result = shell(root, script, SOURCE, target)
    assert result.returncode == 0, result.stdout + result.stderr
    assert target.read_bytes() == changed
    assert gzip.decompress(changed) == payload
    assert target.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize("form", FORMS)
@pytest.mark.parametrize("sink", ("settings", "security", "metadata", "live-log", "append-log"))
def test_other_content_sinks_refuse_every_representation(tmp_path, sink, form):
    value = FORMS[form]
    root = installation(tmp_path, b"." * (65536 - len(value) // 2) + value)
    target = root / "sink.txt"
    if sink == "security":
        script = '''source "$1/server_tools/ctl/lib/instance_restore_security.sh"
docker() { cat row.bin; }
restore_copy_function_security proof admin site replacement instances/proof/backups'''
        result = shell(root, script, SOURCE)
        assert not list((root / "instances/proof/backups").iterdir())
    elif sink in ("live-log", "append-log"):
        if sink == "append-log":
            target.write_bytes(value[:len(value) // 2])
            content = value[len(value) // 2:]
        else:
            content = (root / "row.bin").read_bytes()
        result = shell(root, 'filterest_recovery_content_stream "$PROJECT_ROOT" "$1" "$2"',
                       "live-append" if sink == "append-log" else "live", target, input=content)
        assert not target.exists() or value not in target.read_bytes()
    else:
        target.write_bytes(b"old safe settings\n")
        result = shell(root, 'filterest_recovery_content_to_file "$PROJECT_ROOT" "$1" cat row.bin', target)
        assert target.read_bytes() == b"old safe settings\n"
    assert result.returncode != 0
    assert not list(root.rglob("*.partial.*"))


@pytest.mark.parametrize("mode", ("plain", "gzip", "live", "live-append"))
def test_safe_streams_and_logs_preserve_arbitrary_bytes(tmp_path, mode):
    payload = b"ordinary UTF-8: \xc3\xa4\n\0\xff" * 10000
    root = installation(tmp_path)
    target = root / "safe.log"
    args = [mode]
    if mode.startswith("live"):
        args.append(target)
    result = shell(root, 'filterest_recovery_content_stream "$PROJECT_ROOT" "$@"', *args,
                   input=gzip.compress(payload, mtime=0) if mode == "gzip" else payload)
    assert result.returncode == 0, result.stderr
    assert (target.read_bytes() if mode.startswith("live") else gzip.decompress(result.stdout)
            if mode == "gzip" else result.stdout) == payload


@pytest.mark.parametrize("value", (FORMS["hex-upper"], FORMS["standard-0-padded"], FORMS["urlsafe-0-unpadded"]))
def test_key_bearing_output_and_temporary_directory_names_are_refused(tmp_path, value):
    root = installation(tmp_path)
    name = root / os.fsdecode(value.replace(b"/", b"_"))
    result = shell(root, 'filterest_recovery_content_to_file "$PROJECT_ROOT" "$1" printf safe', name)
    assert result.returncode != 0 and not name.exists()
    result = shell(root, 'filterest_recovery_mktemp "$PROJECT_ROOT" -d -- "$1.XXXXXX"', name)
    assert result.returncode != 0 and not list(root.glob(name.name + ".*"))


def test_append_detects_a_match_across_old_and_new_content(tmp_path):
    root = installation(tmp_path)
    value = FORMS["hex-lower"]
    target = root / "partial.sql"
    target.write_bytes(value[:31])
    (root / "row.bin").write_bytes(value[31:])
    result = shell(root, 'filterest_recovery_content_to_file "$PROJECT_ROOT" "$1" --append cat row.bin', target)
    assert result.returncode != 0 and target.read_bytes() == value[:31]
    assert not list(root.glob("*.partial.*"))


def test_scanner_import_failure_refuses_with_fixed_text(tmp_path):
    root = installation(tmp_path)
    library = root / "library"
    library.mkdir()
    for name in ("installation_records.sh", "recovery_content_files.sh"):
        (library / name).write_bytes((LIBRARY.parent / name).read_bytes())
    result = shell(root, 'filterest_recovery_content_to_file "$PROJECT_ROOT" sink.txt cat row.bin',
                   source=library / "installation_records.sh")
    assert result.returncode != 0 and b"unavailable" in result.stderr
    assert not (root / "sink.txt").exists()


CONTROL_ROUTES = (
    ("ctl", ()), ("app/ctl", ()), ("app/server_tools/ctl/ctl_main.sh", ()),
    ("filterest", ("ctl",)), ("app/filterest", ("ctl",)),
    ("filterest", ("start",)), ("app/filterest", ("start",)),
)


@pytest.mark.parametrize("entry,prefix", CONTROL_ROUTES)
@pytest.mark.parametrize("route", ("single", "all"))
@pytest.mark.parametrize("form", FORMS)
def test_named_control_invocations_reach_the_scanned_backup_writer(tmp_path, entry, prefix, route, form):
    value = FORMS[form]
    root = installation(tmp_path, b"." * (65536 - len(value) // 2) + value)
    copy_launchers(root)
    tools = root / "tools"
    tools.mkdir()
    (tools / "docker").write_text(f"#!{sys.executable}\n" + '''import pathlib, sys
args = sys.argv[1:]
if args[0] == 'ps': print('easelect-proof-db')
elif 'pg_dump' in args: sys.stdout.buffer.write(pathlib.Path('row.bin').read_bytes())
''')
    (tools / "docker").chmod(0o700)
    environment = dict(os.environ, PATH=f'{tools}:{os.environ["PATH"]}',
                       FILTEREST_PROJECT_ROOT_OVERRIDE=str(root), PYTHONDONTWRITEBYTECODE="1")
    args = ("--instance", "proof", "--backup") if route == "single" else ("--instance", "backup-all")
    result = subprocess.run(["/bin/bash", str(root / entry), *prefix, *args], cwd=root, env=environment,
                            capture_output=True, timeout=60)
    assert result.returncode != 0, result.stdout + result.stderr
    assert not list((root / "instances/proof/backups").iterdir())
    assert b"Backing up" in result.stdout, result.stdout + result.stderr
    assert KEY.hex().encode() not in result.stdout + result.stderr


@pytest.mark.parametrize("form", FORMS)
def test_zip_restore_staging_refuses_decoded_members_across_chunks(tmp_path, form):
    value = FORMS[form]
    root = installation(tmp_path)
    source, staging = root / "bootstrap.zip", root / "staging"
    staging.mkdir(mode=0o700)
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("schema.sql", b"." * (65536 - len(value) // 2) + value)
        archive.writestr("seed_data.sql", b"SELECT 42;\n")
    result = shell(root, 'filterest_recovery_extract_zip "$PROJECT_ROOT" "$1" "$2" ""', source, staging)
    assert result.returncode != 0 and not staging.exists()
    assert source.exists()


def test_safe_zip_staging_is_byte_identical_and_does_not_remove_existing_trees(tmp_path):
    root = installation(tmp_path)
    source, staging = root / "bootstrap.zip", root / "staging"
    staging.mkdir(mode=0o700)
    contents = {"schema.sql": b"SELECT 42;\n" * 100000, "seed_data.sql": b"COPY payload FROM stdin;\nordinary\n\\.\n"}
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in contents.items():
            archive.writestr(name, content)
    result = shell(root, 'filterest_recovery_extract_zip "$PROJECT_ROOT" "$1" "$2" ""', source, staging)
    assert result.returncode == 0, result.stderr
    assert {p.name: p.read_bytes() for p in staging.iterdir()} == contents
    result = shell(root, 'filterest_recovery_extract_zip "$PROJECT_ROOT" "$1" "$2" ""', source, staging)
    assert result.returncode != 0
    assert {p.name: p.read_bytes() for p in staging.iterdir()} == contents


@pytest.mark.parametrize("form", FORMS)
def test_gzip_snapshot_without_tar_suffix_refuses_decoded_contents(tmp_path, form):
    from server_tools.lib import database_recovery_packet_io as packet_io
    root = installation(tmp_path)
    value = FORMS[form]
    source = root / "legacy.sql.gz"
    # Concatenated members also retain the scanner overlap at their join.
    source.write_bytes(gzip.compress(b"." * 65520 + value[:len(value) // 2], mtime=0) +
                       gzip.compress(value[len(value) // 2:], mtime=0))
    target = root / "captured.sql.gz"
    with pytest.raises(packet_io.RecoveryError):
        packet_io.snapshot_file(source, target, KEY)
    assert not target.exists() and source.exists()


@pytest.mark.parametrize("operation", ("manifest", "archives"))
def test_preexisting_python_partial_files_are_preserved(tmp_path, operation):
    from server_tools.lib import database_recovery_update as update
    from server_tools.lib import recovery_archives as archives
    root = installation(tmp_path)
    (root / "config").mkdir()
    (root / "projects").mkdir()
    settings = root / "keys/runtime.env"
    settings.write_text("DB_ADMIN_USER=admin\nDB_ADMIN_PASSWORD=fixture\n")
    settings.chmod(0o600)
    packet = root / "backups/packet"
    packet.mkdir(parents=True, mode=0o700)
    name = "manifest.txt.partial" if operation == "manifest" else "installation_settings.tar.gz.partial"
    partial = packet / name
    partial.write_bytes(b"pre-existing partial")
    with pytest.raises((OSError, update.recovery.RecoveryError)):
        if operation == "manifest":
            update.write_manifest(packet, root, "native", [settings], b"safe metadata")
        else:
            archives.create_archives(root, packet, KEY)
    assert partial.read_bytes() == b"pre-existing partial"


@pytest.mark.parametrize("form", FORMS)
@pytest.mark.parametrize("channel", ("certificate", "key"))
def test_tls_generation_refuses_both_output_streams_and_removes_partials(tmp_path, form, channel):
    root = installation(tmp_path, FORMS[form])
    script = '''openssl() {
local out="" key=""
while [[ "$#" -gt 0 ]]; do
case "$1" in -out) out="$2"; shift ;; -keyout) key="$2"; shift ;; esac; shift
done
if [[ CHANNEL == key ]]; then cat row.bin > "$key"; printf safe > "$out";
else cat row.bin > "$out"; printf safe > "$key"; fi
}
filterest_recovery_tls_identity "$PROJECT_ROOT" "$PROJECT_ROOT/cert.pem" "$PROJECT_ROOT/key.pem"
'''.replace("CHANNEL", shlex.quote(channel))
    result = shell(root, script)
    assert result.returncode != 0, result.stdout + result.stderr
    assert not (root / "cert.pem").exists() and not (root / "key.pem").exists()
    assert not list(root.glob("*.partial.*"))


def test_safe_tls_generator_preserves_both_streams(tmp_path):
    root = installation(tmp_path)
    result = shell(root, '''openssl() {
local out="" key=""
while [[ "$#" -gt 0 ]]; do
case "$1" in -out) out="$2"; shift ;; -keyout) key="$2"; shift ;; esac; shift
done
printf 'safe certificate\n' > "$out"; printf 'safe private key\n' > "$key"
}
filterest_recovery_tls_identity "$PROJECT_ROOT" "$PROJECT_ROOT/cert.pem" "$PROJECT_ROOT/key.pem"
''')
    assert result.returncode == 0, result.stderr
    assert (root / "cert.pem").read_bytes() == b"safe certificate\n"
    assert (root / "key.pem").read_bytes() == b"safe private key\n"


@pytest.mark.parametrize("owner", ("docker", "installer"))
@pytest.mark.parametrize("form", FORMS)
def test_real_settings_generators_refuse_copied_content(tmp_path, owner, form):
    root = installation(tmp_path)
    target = root / "settings.env"
    original = b"UPDATED=old\nCOPIED=" + FORMS[form] + b"\n"
    target.write_bytes(original)
    filename = "run_filterest_docker.sh" if owner == "docker" else "install_filterest.sh"
    name = "_docker_recovery_settings_content" if owner == "docker" else "_installation_recovery_settings_content"
    source = (SOURCE / "server_tools" / filename).read_text()
    start = source.index(name + "() {")
    function = source[start:source.index("\n}\n", start) + 3]
    result = shell(root, function + '\nfilterest_recovery_content_to_file "$PROJECT_ROOT" "$1" ' + name + ' "$1" UPDATED safe', target)
    assert result.returncode != 0 and target.read_bytes() == original


def test_cancelled_streaming_backup_removes_only_owned_partial(tmp_path):
    root = installation(tmp_path)
    target = root / "instances/proof/backups/cancelled.gz"
    target.write_bytes(b"pre-existing backup")
    script = 'source "$1"; source "$2/server_tools/ctl/lib/instance_backup.sh"; '
    script += '''load_instance_backup_policy_flags() { eval "$4=()"; }
append_default_instance_backup_exclusions() { :; }
docker() { while true; do printf '%65536s' safe; done; }
write_instance_database_backup proof "$3" admin site
'''
    process = subprocess.Popen(["/bin/bash", "-c", script, "probe", str(LIBRARY), str(SOURCE), str(target)],
                               cwd=root, env=dict(os.environ, PROJECT_ROOT=str(root)),
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        deadline = time.monotonic() + 10
        while not list(target.parent.glob("*.partial.*")) and time.monotonic() < deadline:
            time.sleep(0.01)
        assert list(target.parent.glob("*.partial.*"))
        os.killpg(process.pid, signal.SIGTERM)
        process.communicate(timeout=15)
        assert process.returncode != 0
        assert target.read_bytes() == b"pre-existing backup"
        assert not list(target.parent.glob("*.partial.*"))
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()


@pytest.mark.parametrize("directory", (False, True))
def test_complete_generated_temporary_name_is_checked_before_creation(tmp_path, monkeypatch, directory):
    from server_tools.lib import recovery_key_safety as safety
    # Neither the prefix nor the nonce contains the full key: their join does.
    key = b"0123456789abcdef" * 2
    monkeypatch.setattr(safety.secrets, "token_hex", lambda size: "0123456789abcdef")
    with pytest.raises(safety.RecoveryError):
        safety.private_temporary_path(tmp_path, key, prefix="0123456789abcdef", directory=directory)
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize("directory", (False, True))
def test_safe_recovery_temporary_names_are_private_and_exclusively_created(tmp_path, directory):
    root = installation(tmp_path)
    template = root / "evidence.XXXXXX"
    result = shell(root, 'filterest_recovery_mktemp "$PROJECT_ROOT" ' + ('-d ' if directory else '') + '"$1"', template)
    assert result.returncode == 0, result.stderr
    path = Path(os.fsdecode(result.stdout.strip()))
    assert path.exists() and path.is_dir() == directory
    assert path.stat().st_mode & 0o777 == (0o700 if directory else 0o600)


@pytest.mark.parametrize("form", FORMS)
@pytest.mark.parametrize("kind", ("docker", "git"))
def test_retained_path_boundary_files_refuse_copied_key_content(tmp_path, monkeypatch, form, kind):
    from server_tools.lib import filterest_paths as paths
    from server_tools.lib.database_recovery_packet_io import RecoveryError
    from types import SimpleNamespace
    root = installation(tmp_path)
    monkeypatch.setenv("FILTEREST_RECOVERY_CONTENT_ROOT", str(root))
    homes = paths.resolve_filterest_homes(root)
    content = FORMS[form] + b"\n"
    if kind == "docker":
        (root / "docker").mkdir()
        (root / "docker/Dockerfile").write_text("FROM scratch\n")
        source, destination = root / ".dockerignore", root / "docker/Dockerfile.dockerignore"
        function = paths.render_dockerignore_files
    else:
        (root / ".git/info").mkdir(parents=True)
        source = destination = root / ".git/info/exclude"
        monkeypatch.setattr(paths.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(stdout=str(destination)))
        function = paths.render_git_exclude
    source.write_bytes(content)
    with pytest.raises((RecoveryError, UnicodeError)):
        function(homes)
    assert source.read_bytes() == content
    if kind == "docker":
        assert not destination.exists()


def test_recovery_process_disables_unscanned_child_bytecode_files(tmp_path):
    root = installation(tmp_path)
    module = root / "copied_settings.py"
    module.write_text("setting='" + KEY.hex() + "'\n")
    code = "import os,sys,recovery_process_boundary as b; sys.exit(b.run_process([sys.executable,'-c','import copied_settings'],os.environ,sys.argv[1]))"
    environment = dict(os.environ, PYTHONPATH=str(SOURCE / "server_tools/lib") + os.pathsep + str(root),
                       PYTHONDONTWRITEBYTECODE="")
    result = subprocess.run([sys.executable, "-B", "-c", code, str(root)], env=environment, capture_output=True, timeout=30)
    assert result.returncode == 0 and not (root / "__pycache__").exists(), result.stderr


def test_native_recovery_refuses_before_compiler_and_runner_files(tmp_path):
    root = installation(tmp_path)
    result = shell(root, 'source "$1"; FILTEREST_RECOVERY_CONTENT_ROOT="$PROJECT_ROOT"; '
                         'go() { touch unexpected-build; }; start_local', SOURCE / "server_tools/ctl/lib/local.sh")
    assert result.returncode == 1 and b'Recovery native source build refused' in result.stderr
    assert not (root / 'unexpected-build').exists() and not (root / 'runtime').exists()


@pytest.mark.parametrize("form", FORMS)
def test_generated_installation_identity_is_validated_before_retention(tmp_path, form):
    root = installation(tmp_path, FORMS[form])
    source = (SOURCE / "server_tools/install_filterest.sh").read_text()
    start = source.index("configure_installation_database_identity() {")
    function = source[start:source.index("\n}\n", start) + 3]
    script = function + '''
FILTEREST_RECOVERY_CONTENT_ROOT="$PROJECT_ROOT"; INSTALLATION_ROOT="$PROJECT_ROOT"; RUNTIME_ROOT="$PROJECT_ROOT/runtime"
verified_legacy_database_identity() { return 1; }
openssl() { cat row.bin; }
die() { printf 'Invalid generated installation identity.\n' >&2; exit 1; }
configure_installation_database_identity runtime.env development.env
'''
    result = shell(root, script)
    assert result.returncode == 1 and not (root / "runtime").exists()


@pytest.mark.parametrize("operation", ("backup", "certificate", "private-key"))
def test_colliding_unowned_stage_is_never_removed(tmp_path, operation):
    root = installation(tmp_path)
    collision = root / "unowned.partial.keep"
    collision.write_bytes(b"pre-existing unowned stage")
    helper = (SOURCE / "server_tools/lib/recovery_content_files.sh").read_text()
    start = helper.index("filterest_recovery_content_stream() {")
    function = helper[start:helper.index("\n}\n", start) + 3]
    function = function.replace("filterest_recovery_content_stream()", "_e15_real_stream()", 1)
    function = function.replace('local library_directory="${BASH_SOURCE[0]%/*}"',
                                "local library_directory=" + shlex.quote(str(SOURCE / "server_tools/lib")))
    script = function + '''
filterest_recovery_content_stream() {
if [[ "$2" == temporary-name && ( "$OPERATION" != private-key || "$4" == *key.pem.partial.* ) ]]; then
    printf '%s\n' "$COLLISION"
else _e15_real_stream "$@"; fi
}
OPERATION="$1"; COLLISION="$2"
if [[ "$OPERATION" == backup ]]; then
    filterest_recovery_content_to_file "$PROJECT_ROOT" "$PROJECT_ROOT/result.gz" --gzip --exclusive printf safe
else
    filterest_recovery_tls_identity "$PROJECT_ROOT" "$PROJECT_ROOT/cert.pem" "$PROJECT_ROOT/key.pem"
fi
'''
    result = shell(root, script, operation, collision)
    assert result.returncode != 0 and collision.read_bytes() == b"pre-existing unowned stage"
    assert set(root.glob("*.partial.*")) == {collision}
    assert not any((root / name).exists() for name in ("result.gz", "cert.pem", "key.pem"))


@pytest.mark.parametrize("form", FORMS)
def test_compressor_output_is_refused_after_decoding_even_for_safe_dump(tmp_path, form):
    root = installation(tmp_path)
    value = FORMS[form]
    (root / "compressor.bin").write_bytes(gzip.compress(b"." * (65536-len(value)//2) + value, mtime=0))
    result = shell(root, '''gzip() { cat >/dev/null; cat compressor.bin; }
filterest_recovery_content_to_file "$PROJECT_ROOT" "$PROJECT_ROOT/result.gz" --gzip --exclusive cat row.bin
''')
    assert result.returncode != 0 and not (root / "result.gz").exists()
    assert not list(root.glob("*.partial.*"))
