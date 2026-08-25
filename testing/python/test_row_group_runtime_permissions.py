"""Focused static contract for DB 9.6.3 row-group runtime read repair."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "server_tools/migrations/20260824000002_repair_row_group_runtime_permissions.sql"
ALLOWLIST = ROOT / "server_tools/public_slice_export/allowlist.txt"
STARTUP = ROOT / "main.go"


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
    listen_index = startup.index("srv.ListenAndServe")

    assert grant_index < fatal_index < listen_index
