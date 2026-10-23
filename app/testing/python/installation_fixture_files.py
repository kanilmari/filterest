"""The shared libraries and data an installation's lifecycle scripts read at start.

Bridges the tests that copy the installer, the updater or the ./filterest
launcher into a temporary installation folder.
Exists so a newly shared library is added to every such fixture in one place:
the library files the copied scripts name are derived from their text, so a
new helper reaches the fixtures without a list edit (batch 518's build-stamp
helper was missed by the fixed list).
"""

from __future__ import annotations

from pathlib import Path
import re

APP_ROOT = Path(__file__).resolve().parents[2]
# The lifecycle scripts the fixtures copy and run as themselves. The installer and
# the admin runner are replaced by recorders there, so their helpers stay opt-in.
LIFECYCLE_ENTRY_SCRIPTS = ("server_tools/run_filterest_docker.sh", "server_tools/update_filterest.sh")
LIBRARY_DIRS = ("server_tools/lib", "server_tools/ctl/lib")
# "server_tools.lib.x" or "from server_tools.lib import a, b" (one line, or a parenthesized list).
_PYTHON_LIBRARY_IMPORT = re.compile(r"server_tools\.(?:ctl\.)?lib(?:\.([A-Za-z0-9_]+)| import (\([^)]*\)|[A-Za-z0-9_, \t]+))")
_COMPUTED_LIBRARY_NAME = re.compile(r"lib/\$")


def library_files(app_root=APP_ROOT):
    """{file name: [relative paths]} of the regular files directly in the library folders
    that resolve inside app_root (a link out of the tree is never copied)."""
    root = Path(app_root).resolve()
    files = {}
    for folder in LIBRARY_DIRS:
        base = Path(app_root) / folder
        if base.is_dir():
            for path in sorted(base.iterdir()):
                if path.is_file() and path.resolve().is_relative_to(root):
                    files.setdefault(path.name, []).append(f"{folder}/{path.name}")
    return files


def referenced_library_files(scripts=LIFECYCLE_ENTRY_SCRIPTS, app_root=APP_ROOT):
    """Every library file whose NAME the scripts contain as a whole word, in any path form
    (a variable such as "$HELPER_DIR/x.sh" included), or that they import as
    server_tools.(ctl.)lib modules; followed through the named shell and Python files.
    A name in a comment counts too, which only copies one more real file. Only a name
    built at run time escapes; computed_library_references() reports those."""
    files = library_files(app_root)
    if not files:
        return set()
    word = re.compile(r"(?<![A-Za-z0-9_.-])(" + "|".join(map(re.escape, sorted(files, key=len, reverse=True)))
                      + r")(?![A-Za-z0-9_.-])")
    found, pending = set(), list(scripts)
    while pending:
        text = (Path(app_root) / pending.pop()).read_text(encoding="utf-8", errors="replace")
        names = set(word.findall(text))
        for module, imported in _PYTHON_LIBRARY_IMPORT.findall(text):
            names.update(f"{name}.py" for name in ([module] if module else re.findall(r"[A-Za-z0-9_]+", imported)))
        for name in names:
            for relative in files.get(name, ()):
                if relative not in found:
                    found.add(relative)
                    if relative.endswith((".sh", ".py")):
                        pending.append(relative)
    return found


def computed_library_references(scripts, app_root=APP_ROOT):
    """(script, line) of every "lib/$…" in the scripts: a library file name built at run time."""
    hits = []
    for relative in scripts:
        if relative.endswith((".sh", ".py")):
            text = (Path(app_root) / relative).read_text(encoding="utf-8", errors="replace")
            hits.extend((relative, number) for number, line in enumerate(text.splitlines(), 1)
                        if _COMPUTED_LIBRARY_NAME.search(line))
    return hits


_LISTED_LIBRARY_FILES = (
    "server_tools/lib/native_host_packages.list",
    "server_tools/lib/native_host_package_reader.sh",
    "server_tools/lib/native_update_preflight.sh",
    "server_tools/lib/easelect_private_paths.sh",
    "server_tools/lib/filterest_paths.py",
    "server_tools/lib/filterest_port_preflight.sh",
    "server_tools/lib/native_development_ports.env",
    "server_tools/lib/database_dump_options.sh",
    "server_tools/lib/database_recovery.py",
    "server_tools/lib/database_recovery_check.py",
    "server_tools/lib/database_recovery_archive_guard.py",
    "server_tools/lib/database_recovery_counts.py",
    "server_tools/lib/database_recovery_prerequisites.py",
    "server_tools/lib/database_recovery_cli.py",
    "server_tools/lib/database_recovery_packet_io.py",
    "server_tools/lib/database_recovery_role_selection.py",
    "server_tools/lib/recovery_archives.py",
    "server_tools/lib/recovery_key_safety.py",
    "server_tools/lib/recovery_content_stream.py",
    "server_tools/lib/recovery_native_runtime.py",
    "server_tools/lib/recovery_checkout_preflight.py",
    "server_tools/lib/recovery_content_files.sh",
    "server_tools/lib/database_recovery_tools.py",
    "server_tools/lib/database_recovery_update.py",
    "server_tools/ctl/lib/instance_restore_create.sql",
    "server_tools/ctl/lib/instance_restore_preflight.sql",
    "server_tools/ctl/lib/instance_restore_properties.sql",
    "server_tools/ctl/lib/instance_restore_verify.sql",
    "server_tools/ctl/lib/instance_restore_settings.sql",
    "server_tools/ctl/lib/instance_restore_acl.sql",
    "server_tools/ctl/lib/instance_restore_swap.sql",
    "server_tools/lib/docker_deployment_settings.sh",
    "server_tools/lib/docker_compose_contract.py",
    "server_tools/lib/docker_network_validator.py",
    "server_tools/lib/installation_records.sh",
    "server_tools/lib/recovery_process_boundary.sh",
    "server_tools/lib/recovery_process_boundary.py",
)
# Everything copied runs, so the derivation starts from the entry scripts AND the listed
# helpers. The listed files keep their order; anything else they name follows.
COPIED_SCRIPT_SEEDS = LIFECYCLE_ENTRY_SCRIPTS + tuple(p for p in _LISTED_LIBRARY_FILES if p.endswith((".sh", ".py")))
LIFECYCLE_LIBRARY_FILES = _LISTED_LIBRARY_FILES + tuple(
    sorted(referenced_library_files(COPIED_SCRIPT_SEEDS) - set(_LISTED_LIBRARY_FILES)))


# Catalogue responses for transport-only update/runner tests. Real SQL behaviour
# belongs to test_database_recovery_postgres.py's isolated PostgreSQL fixture.
RECOVERY_PSQL_FAKE = """#!/usr/bin/env python3
import json, sys
sql = sys.stdin.read()
if 'WITH RECURSIVE roots' in sql:
    print(json.dumps({'roles':['native_admin','docker_owner','container_owner'], 'bootstrap':'cluster_bootstrap'}))
elif "SELECT pg_temp.database_snapshot(:'target')" in sql:
    print('{"properties":{"datconnlimit":-1,"datallowconn":true},"owner":"native_admin","tablespace":"pg_default","settings":[],"acl":[]}')
elif "SELECT jsonb_build_object('relations'" in sql:
    print('{"relations":5,"functions":0}')
"""
