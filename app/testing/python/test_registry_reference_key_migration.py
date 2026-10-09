"""test_registry_reference_key_migration.py
Prove WL144's registry-key migration and bootstrap acceptance on disposable PostgreSQL.
Reuse WL58's bootstrap and genuine 9.9.2 upgrade fixtures through imported fixtures.
Keep registry-key protection, precheck and rerun proofs separate from actor support.
"""
from __future__ import annotations

import os
import socket

import pytest

from test_row_actor_support import (
    APP, BOOTSTRAP, GENERATOR, MIGRATIONS, RELEASE_RECORD,
    cluster, installed, prepared, upgrade, refused, value,
)

REGISTRY_KEY = MIGRATIONS / "20261005000050_require_registry_reference_key.sql"


def registry_key_transaction():
    # Match the migration runner: one transaction retains the precheck lock through DDL.
    return "BEGIN;\n" + REGISTRY_KEY.read_text() + "\nCOMMIT;"


# WL144 uses the same bootstrap, 9.9.2 upgrade and already-recorded development
# fixtures as the release data step; none of these addresses an installed site.
def test_registry_reference_step_is_seeded_checked_and_snapshotted():
    current_db = (APP / "VERSION_DB").read_text(encoding="utf-8").strip()
    sql = REGISTRY_KEY.read_text()
    for header in ('VERSION_DB: 9.10.0', 'VERSION_DB_OWNER: ' + RELEASE_RECORD.name,
                   'COMPLETION_MARKER: wl144_registry_reference_key',
                   'FINAL_CHECK: public.app_check_registry_reference_key()'):
        assert '-- ' + header in sql
    assert sql.index('LOCK TABLE') < sql.index('precheck refused') < sql.index('CREATE OR REPLACE FUNCTION')
    assert sql.index('CREATE OR REPLACE FUNCTION') < sql.index('ALTER TABLE public.system_db_tables')
    assert 'column_detail.table_uid = registry.table_uid' in sql
    generator = GENERATOR.read_text()
    classification = generator.split('release_data_migrations = (', 1)[1].split(')', 1)[0]
    assert REGISTRY_KEY.name in classification
    seed = (BOOTSTRAP / 'seed_data.sql').read_text()
    assert seed.index('END $row_actors$;') < seed.index('DO $registry_key$') < seed.index('DO $filterest_acceptance$')
    acceptance = seed.split('DO $filterest_acceptance$', 1)[1]
    assert "'wl144_registry_reference_key'" in acceptance
    assert 'FROM public.app_check_registry_reference_key() AS result' in acceptance
    assert (APP / f'server_tools/versioning/schema_snapshots/db-{current_db}.sql').read_bytes() == (BOOTSTRAP / 'schema.sql').read_bytes()


def registry_key_snapshot(run):
    return value(run, """
        SELECT jsonb_build_object(
            'registry', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM system_db_tables r),
            'metadata', (SELECT jsonb_agg(to_jsonb(c) ORDER BY column_uid) FROM system_column_details c),
            'markers', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM system_data_repair_records r),
            'required', (SELECT attnotnull FROM pg_attribute WHERE attrelid='system_db_tables'::regclass AND attname='table_uid'),
            'versions', (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM system_db_version v));
    """)


def assert_registry_key_completed(run):
    assert value(run, 'SELECT count(*) FROM public.app_check_registry_reference_key()') == '0'
    assert value(run, "SELECT count(*) FROM system_data_repair_records WHERE migration='wl144_registry_reference_key' AND action='completed'") == '1'
    before = registry_key_snapshot(run)
    run(registry_key_transaction())
    assert registry_key_snapshot(run) == before


def test_registry_key_fresh_bootstrap_and_rerun(registry_key_installed):
    assert_registry_key_completed(registry_key_installed)


@pytest.mark.parametrize('already_recorded', [False, True])
def test_registry_key_upgrade_uses_uid_despite_different_registry_id(registry_key_prepared, already_recorded):
    prepared = registry_key_prepared
    # The old seed and schema are the genuine DB 9.9.2 ones; support/conversion
    # precede this step, exactly as in an upgrade. A developer may have run the
    # release record earlier, which must not suppress a new pre-record migration.
    if already_recorded:
        prepared(RELEASE_RECORD.read_text())
    prepared("""
        UPDATE system_db_tables SET id=700000 WHERE table_name='system_db_tables';
        INSERT INTO system_db_tables (id, table_uid, table_name, schema_name)
        VALUES (700001, 700000, 'registry_key_decoy', 'public');
        INSERT INTO system_column_details (table_uid, column_name, editable_in_ui)
        VALUES (700000, 'table_uid', true);
        INSERT INTO system_column_details (table_uid, column_name, editable_in_ui)
        SELECT table_uid, 'table_uid', true FROM system_db_tables
        WHERE table_name='system_db_tables';
    """)
    actual_metadata = ("SELECT editable_in_ui FROM system_column_details WHERE column_name='table_uid' "
                       "AND table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='system_db_tables')")
    assert value(prepared, actual_metadata) == 't', 'real registry-key metadata must exist before migrating'
    prepared(registry_key_transaction())
    assert value(prepared, actual_metadata) == 'f'
    assert value(prepared, "SELECT editable_in_ui FROM system_column_details WHERE table_uid=700000 AND column_name='table_uid'") == 't'
    assert value(prepared, "SELECT id <> table_uid FROM system_db_tables WHERE table_name='system_db_tables'") == 't'
    assert_registry_key_completed(prepared)
    prepared(RELEASE_RECORD.read_text())
    assert value(prepared, "SELECT count(*) FROM system_db_version WHERE version='9.10.0'") == '1'


def test_registry_key_NULL_precheck_rolls_back_and_records_nothing(registry_key_prepared):
    prepared = registry_key_prepared
    prepared("INSERT INTO system_db_tables (id, table_uid, table_name, schema_name) VALUES (700003, NULL, 'missing_registry_key', 'public')")
    before = registry_key_snapshot(prepared)
    refused(prepared, registry_key_transaction(), 'rows 700003 have no table_uid')
    assert registry_key_snapshot(prepared) == before
    assert value(prepared, "SELECT count(*) FROM system_data_repair_records WHERE migration='wl144_registry_reference_key'") == '0'
    assert value(prepared, "SELECT to_regprocedure('public.app_check_registry_reference_key()') IS NULL") == 't'


def test_registry_key_NULL_precheck_still_refuses_after_completion(registry_key_installed):
    installed = registry_key_installed
    assert_registry_key_completed(installed)
    installed("ALTER TABLE system_db_tables ALTER COLUMN table_uid DROP NOT NULL; "
              "INSERT INTO system_db_tables (id, table_uid, table_name, schema_name) "
              "VALUES (700003, NULL, 'missing_registry_key', 'public')")
    before = registry_key_snapshot(installed)
    refused(installed, registry_key_transaction(), 'rows 700003 have no table_uid')
    assert registry_key_snapshot(installed) == before
    assert value(installed, "SELECT count(*) FROM system_data_repair_records WHERE migration='wl144_registry_reference_key' AND action='completed'") == '1'


def test_registry_key_absent_metadata_counts_as_protected(registry_key_prepared):
    # The generic row editor refuses a column without a metadata row, as on a fresh
    # installation; only a row that still allows editing fails the final check.
    prepared = registry_key_prepared
    registry_uid = "(SELECT table_uid FROM system_db_tables WHERE table_name='system_db_tables')"
    prepared(f"DELETE FROM system_column_details WHERE column_name='table_uid' AND table_uid={registry_uid}")
    prepared(registry_key_transaction())
    assert_registry_key_completed(prepared)
    prepared(f"INSERT INTO system_column_details (table_uid, column_name, editable_in_ui) VALUES ({registry_uid}, 'table_uid', true)")
    assert value(prepared, 'SELECT count(*) FROM public.app_check_registry_reference_key()') == '1'


@pytest.fixture
def registry_key_socket_allowed(tmp_path):
    if os.environ.get('FILTEREST_TEST_DISPOSABLE_POSTGRES') != '1':
        pytest.skip('set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL checks')
    # Probe before asking the shared fixtures to start a cluster. Only an explicit
    # sandbox denial skips these tests; SQL and ordinary startup failures still fail.
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(str(tmp_path / 'pg-probe'))
        except PermissionError:
            pytest.skip('sandbox refuses disposable PostgreSQL Unix sockets')


@pytest.fixture
def registry_key_installed(registry_key_socket_allowed, request):
    return request.getfixturevalue('installed')


@pytest.fixture
def registry_key_prepared(registry_key_socket_allowed, request):
    return request.getfixturevalue('prepared')
