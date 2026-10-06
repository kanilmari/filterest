"""Released row-group read repair and current heading runtime SELECT-only grants."""

from pathlib import Path
import re

import pytest
from test_row_actor_support import cluster, installed, value  # noqa: F401


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "server_tools/migrations/20260824000002_repair_row_group_runtime_permissions.sql"
ALLOWLIST = ROOT / "server_tools/public_slice_export/allowlist.txt"
STARTUP = ROOT / "backend/core_components/application_runtime/application_runner.go"


def test_row_group_runtime_permission_migration_is_select_only_and_version_owner() -> None:
    source = MIGRATION.read_text(encoding="utf-8")

    assert "VERSION_DB: 9.6.3" in source
    assert "ARRAY['basic_user', 'guest_user', 'readeronly']" in source
    assert "GRANT USAGE ON SCHEMA public" in source
    assert "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER" in source
    assert "REVOKE USAGE, UPDATE ON SEQUENCE" in source
    assert "GRANT SELECT ON TABLE public.system_row_groups, public.system_row_group_memberships" in source
    assert "GRANT INSERT" not in source
    assert source.count("'9.6.3'") == 2


def test_row_group_runtime_permission_repair_ships_and_runs_after_migrations() -> None:
    startup = STARTUP.read_text(encoding="utf-8")

    # The private generator allowlist proves export ownership in Easelect. It is
    # intentionally absent from the generated public repository, where the
    # migration's presence is the equivalent self-contained contract.
    if ALLOWLIST.is_file():
        allowlist = ALLOWLIST.read_text(encoding="utf-8")
        assert "20260824000002_repair_row_group_runtime_permissions.sql" in allowlist
    else:
        assert MIGRATION.is_file()
    assert "EnsureRowGroupRuntimeRolePermissions" in startup
    assert startup.index("startup.RunEnabledMigrations") < startup.index(
        "backend.EnsureRowGroupRuntimeRolePermissions"
    )


def test_row_group_runtime_permission_failure_stops_before_readiness() -> None:
    startup = STARTUP.read_text(encoding="utf-8")
    grant_index = startup.index("backend.EnsureRowGroupRuntimeRolePermissions")
    fatal_index = startup.index(
        'log.Fatalf("[ROW GROUP PERMISSIONS] startup reconcile failed: %v", err)',
        grant_index,
    )
    listen_index = startup.index("server.ListenAndServe")

    assert grant_index < fatal_index < listen_index


# WL103 exercises the current startup grant SQL on an opt-in disposable cluster.
# The released 9.6.3 repair above remains historical and must not be edited.
@pytest.mark.parametrize("role", ["wl103_basic", "wl103_guest", "wl103_readonly"])
def test_headings_and_row_groups_are_select_only_for_runtime_roles(installed, role):
    installed(f"CREATE ROLE {role} NOLOGIN")
    tables = ("system_row_groups", "system_row_group_memberships", "system_row_group_classifications")
    for table in tables:
        installed(f"GRANT ALL ON TABLE public.{table} TO {role}; GRANT ALL ON SEQUENCE public.{table}_id_seq TO {role}")
    source = (ROOT / "backend/core_components/row_group_runtime_permissions.go").read_text()
    grant_sql = re.search(r"return fmt.Sprintf\(`(.*?)`, quotedRole", source, re.S).group(1)
    installed(grant_sql.replace("%s", f'"{role}"'))
    for table in tables:
        assert value(installed, f"SELECT has_table_privilege('{role}','public.{table}','SELECT')") == "t"
        for privilege in ("INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"):
            assert value(installed, f"SELECT has_table_privilege('{role}','public.{table}','{privilege}')") == "f"
        for privilege in ("USAGE", "UPDATE"):
            assert value(installed, f"SELECT has_sequence_privilege('{role}','public.{table}_id_seq','{privilege}')") == "f"
        assert value(installed, f"SET ROLE {role}; SELECT count(*) FROM public.{table}; RESET ROLE") == "0"
