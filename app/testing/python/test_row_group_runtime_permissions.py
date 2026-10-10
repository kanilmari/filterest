# test_row_group_runtime_permissions.py
# Proves the users', visitors' and read-only database roles may read row-group metadata but never change it.
# Connects the released 9.6.3 repair migration with the start-up grant policy that replaced its start-up step.
# Category headings, groups and memberships are administrator data; a site must not open before this holds.

from pathlib import Path
import os
import re
import subprocess
import tempfile

import pytest
from test_row_actor_support import cluster, installed, value  # noqa: F401


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "server_tools/migrations/20260824000002_repair_row_group_runtime_permissions.sql"
ALLOWLIST = ROOT / "server_tools/public_slice_export/allowlist.txt"
RUNNER = ROOT / "backend/core_components/application_runtime/application_runner.go"
STARTUP_SEQUENCE = ROOT / "backend/core_components/application_runtime/startup_sequence.go"
TABLES = ("system_row_groups", "system_row_group_memberships", "system_row_group_classifications")
TABLE_PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")
COLUMN_WRITES = ("INSERT", "UPDATE", "REFERENCES")
SEQUENCE_WRITES = ("USAGE", "UPDATE")
EVERY_PRIVILEGE = {*TABLE_PRIVILEGES, *(f"column {name}" for name in COLUMN_WRITES),
                   *(f"sequence {name}" for name in SEQUENCE_WRITES)}
# Start-up refuses to run without all four runtime identities; the guarantee covers the first three.
ROLES = {"basic": "wl103_basic", "guest": "wl103_guest", "readonly": "wl103_readonly",
         "confidential": "wl103_confidential"}
READERS = ("basic", "guest", "readonly")


def test_row_group_runtime_permission_migration_is_select_only_and_version_owner() -> None:
    # The released 9.6.3 repair remains historical and must not be edited.
    source = MIGRATION.read_text(encoding="utf-8")

    assert "VERSION_DB: 9.6.3" in source
    assert "ARRAY['basic_user', 'guest_user', 'readeronly']" in source
    assert "GRANT USAGE ON SCHEMA public" in source
    assert "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER" in source
    assert "REVOKE USAGE, UPDATE ON SEQUENCE" in source
    assert "GRANT SELECT ON TABLE public.system_row_groups, public.system_row_group_memberships" in source
    assert "GRANT INSERT" not in source
    assert source.count("'9.6.3'") == 2


def test_row_group_runtime_permission_repair_still_ships() -> None:
    # The private generator allowlist proves export ownership in Easelect. It is
    # intentionally absent from the generated public repository, where the
    # migration's presence is the equivalent self-contained contract.
    if ALLOWLIST.is_file():
        allowlist = ALLOWLIST.read_text(encoding="utf-8")
        assert "20260824000002_repair_row_group_runtime_permissions.sql" in allowlist
    else:
        assert MIGRATION.is_file()
    # WL124 replaced the repair's own start-up step with the start-up grant policy. Its place
    # after migrations is proven by TestRequiredStartupOrdersInputsBeforeGrantsAndConsumers
    # (application_runtime/startup_sequence_test.go); TestFreshBootstrapBasicAndGuestBrowseArticleSearchPostgres
    # (startup_browsing_postgres_test.go) runs that whole sequence on the shipped bootstrap.


def test_row_group_runtime_permission_failure_stops_before_readiness() -> None:
    # TestRequiredStartupPropagatesEveryFailureBeforeReadiness (startup_sequence_test.go) stops the
    # sequence at a failed step. TestActorPackageRuntimeRoleChainPostgres (dtt_crud_workflows) and
    # TestStartupStructuralFailureRollsBackEntireCataloguePostgres (runtime_grants) prove that the
    # grant step refuses an unsafe role and changes nothing. This holds the links between them: the
    # step returns the policy's error, and that error ends the process before database admission
    # and every listener.
    sequence = STARTUP_SEQUENCE.read_text(encoding="utf-8")
    assert re.search(r'\{"runtime grants", func\(\) error \{\s*return backend\.EnsureRuntimeRoleGrants\(', sequence)

    runner = RUNNER.read_text(encoding="utf-8")
    start_up = re.search(
        r"if err := runtime_grants\.WithStartupBarrier\([^\n]*\{\s*"
        r"return runRequiredStartup\(requiredStartupSteps\([^\n]*\s*"
        r"\}\); err != nil \{\s*"
        r'log\.Fatalf\("\[STARTUP\] required initialization failed; site is not ready: %v", err\)',
        runner,
    )
    assert start_up
    readiness = [runner.index("backend.EnableRuntimeDatabaseAdmission()")]
    readiness += [listener.start() for listener in re.finditer("ListenAndServe", runner)]
    assert start_up.end() < min(readiness)


# The bridge runs start-up's grant step as the required sequence calls it: inside the
# exclusive start-up barrier, with the four runtime pools connected as their configured
# roles. lib/pq reaches the disposable cluster only through PGHOST, PGPORT and PGDATABASE.
START_UP_GRANT_STEP = r'''
package main

import (
    "context"
    "database/sql"
    "fmt"
    "os"

    backend "easelect/backend/core_components"
    "easelect/backend/core_components/runtime_grants"
    _ "github.com/lib/pq"
)

func pool(key string) *sql.DB {
    db, err := sql.Open("postgres", "user="+os.Getenv(key))
    if err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(2)
    }
    return db
}

func main() {
    ctx := context.Background()
    backend.DbAdmin, backend.DbLifecycle = pool("DB_ADMIN_USER"), pool("DB_ADMIN_USER")
    backend.DbBasic, backend.DbGuest = pool("DB_BASIC_USER"), pool("DB_GUEST_USER")
    backend.DbReaderOnly, backend.DbConfidential = pool("DB_READONLY_USER"), pool("DB_CONFIDENTIAL_USER")
    err := runtime_grants.WithStartupBarrier(ctx, backend.DbLifecycle, func() error {
        return backend.EnsureRuntimeRoleGrants(ctx, backend.DbAdmin)
    })
    if err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}
'''


@pytest.fixture(scope="module")
def start_up_grant_step():
    """Builds the bridge once, and only for the opt-in PostgreSQL check."""
    if os.environ.get("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1":
        pytest.skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL checks")
    with tempfile.TemporaryDirectory(prefix="row-group-start-up-grants-") as directory:
        source = Path(directory) / "main.go"
        source.write_text(START_UP_GRANT_STEP, encoding="utf-8")
        binary = Path(directory) / "start-up-grant-step"
        # conftest places Go's module and build caches, as for the other Go-compiling tests.
        result = subprocess.run(
            ["go", "build", "-o", str(binary), str(source)],
            cwd=ROOT, env={**os.environ, "GOTOOLCHAIN": "local"}, capture_output=True, text=True, timeout=600,
        )
        assert result.returncode == 0, "start-up grant step compilation failed:\n" + result.stderr
        yield binary


def held_privileges(installed, role, table):
    """Names the privileges a role holds on a row-group table, its columns and its identity sequence."""
    checks = {name: f"has_table_privilege('{role}', 'public.{table}', '{name}')" for name in TABLE_PRIVILEGES}
    for name in COLUMN_WRITES:
        checks[f"column {name}"] = f"has_any_column_privilege('{role}', 'public.{table}', '{name}')"
    for name in SEQUENCE_WRITES:
        checks[f"sequence {name}"] = f"has_sequence_privilege('{role}', 'public.{table}_id_seq', '{name}')"
    row = value(installed, "SELECT " + ", ".join(checks.values())).split("|")
    return {name for name, held in zip(checks, row) if held == "t"}


def test_headings_and_row_groups_are_select_only_for_runtime_roles(start_up_grant_step, installed):
    for name in ROLES.values():
        installed(f"CREATE ROLE {name} LOGIN")
    # A legacy installation can hold every privilege; the 9.6.3 repair was written for that case.
    for label in READERS:
        for table in TABLES:
            installed(f"GRANT ALL ON TABLE public.{table} TO {ROLES[label]}; "
                      f"GRANT ALL ON SEQUENCE public.{table}_id_seq TO {ROLES[label]}")
            assert held_privileges(installed, ROLES[label], table) == EVERY_PRIVILEGE
    owner = value(installed, "SELECT current_user")
    environment = {
        "PATH": os.environ.get("PATH", ""),
        "PGHOST": value(installed, "SHOW unix_socket_directories"),
        "PGPORT": value(installed, "SHOW port"),
        "PGDATABASE": value(installed, "SELECT current_database()"),
        "PGSSLMODE": "disable",
        "DB_ADMIN_USER": owner,
        "DB_USER": owner,
        **{f"DB_{label.upper()}_USER": name for label, name in ROLES.items()},
    }

    result = subprocess.run([str(start_up_grant_step)], env=environment, capture_output=True, text=True, timeout=120)

    assert result.returncode == 0, result.stderr
    for label in READERS:
        for table in TABLES:
            assert held_privileges(installed, ROLES[label], table) == {"SELECT"}, (label, table)
            assert value(installed, f"SET ROLE {ROLES[label]}; SELECT count(*) FROM public.{table}; RESET ROLE").isdigit()
