"""The shared libraries and data an installation's lifecycle scripts read at start.

Bridges the tests that copy the installer, the updater or the ./filterest
launcher into a temporary installation folder.
Exists so a newly shared library is added to every such fixture in one place.
"""

from __future__ import annotations

LIFECYCLE_LIBRARY_FILES = (
    "server_tools/lib/native_host_packages.list",
    "server_tools/lib/native_host_package_reader.sh",
    "server_tools/lib/native_update_preflight.sh",
    "server_tools/lib/easelect_private_paths.sh",
    "server_tools/lib/filterest_paths.py",
    "server_tools/lib/filterest_port_preflight.sh",
    "server_tools/lib/native_development_ports.env",
    "server_tools/lib/database_dump_options.sh",
    "server_tools/lib/database_recovery.py",
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
    "server_tools/lib/docker_network_validator.py",
    "server_tools/lib/installation_records.sh",
    "server_tools/lib/recovery_process_boundary.sh",
    "server_tools/lib/recovery_process_boundary.py",
)


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
