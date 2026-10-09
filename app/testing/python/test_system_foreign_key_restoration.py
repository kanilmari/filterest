"""Prove the system tables end with their own relationships, however a site got there.

Runs the DB 9.9.0 restoration on disposable PostgreSQL clusters shaped like a site
that never received the twenty foreign keys, like one that already has them, and
like one whose schema disagrees. Also installs the reviewed public bootstrap whole
and checks the same twenty are there without any migration having run.
Protects the exact constraint names and delete actions, so a repaired database and
a newly installed one cannot drift apart while reporting the same version.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile

import pytest

from bootstrap_contract_assertions import assert_bootstrap_baseline

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
RESTORE = MIGRATIONS / "20260926000001_restore_system_foreign_keys.sql"
RECORD = MIGRATIONS / "20260926000002_record_system_foreign_key_release.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
GENERATOR = BOOTSTRAP / "generate_bootstrap.py"


def _version(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in text.split("."))

# The twenty relationships as a production database that has them stores them:
# child table, constraint name, child column, parent table, parent column, and the
# delete rule ('a' = NO ACTION, 'c' = CASCADE, 'n' = SET NULL). Ten of the names are
# older than the tables' current names and are kept exactly, so a repaired database
# and one that was always correct compare equal.
EXPECTED = (
    ("system_column_control", "fk_system_column_control_column_uid", "column_uid", "system_column_details", "column_uid", "c"),
    ("system_column_control", "fk_system_column_control_table_uid", "table_uid", "system_db_tables", "table_uid", "c"),
    ("system_db_tables", "fk_system_db_tables_default_view_id", "default_view_id", "system_table_views", "id", "n"),
    ("system_db_tables", "fk_system_db_tables_folder_id", "folder_id", "system_table_folders", "id", "a"),
    ("system_foreign_key_relations_1_m", "fk_rel_1m_source_uid_fk", "source_table_uid", "system_db_tables", "table_uid", "c"),
    ("system_foreign_key_relations_1_m", "fk_rel_1m_target_uid_fk", "target_table_uid", "system_db_tables", "table_uid", "c"),
    ("system_foreign_key_relations_m_m", "fk_rel_mm_bridge_uid_fk", "bridging_table_uid", "system_db_tables", "table_uid", "c"),
    ("system_foreign_key_relations_m_m", "fk_rel_mm_table_a_uid_fk", "table_a_uid", "system_db_tables", "table_uid", "c"),
    ("system_foreign_key_relations_m_m", "fk_rel_mm_table_b_uid_fk", "table_b_uid", "system_db_tables", "table_uid", "c"),
    ("system_group_table_func_rights", "auth_group_func_rights_auth_user_group_id_fkey", "user_group_id", "system_user_groups", "id", "c"),
    ("system_group_table_func_rights", "auth_group_func_rights_function_id_fkey", "function_id", "system_functions", "id", "c"),
    ("system_group_table_func_rights", "auth_group_table_func_rights_target_table_uid_fkey", "target_table_uid", "system_db_tables", "table_uid", "c"),
    ("system_lang_key_sources", "system_lang_key_sources_lang_key_id_fkey", "lang_key_id", "system_lang_keys", "id", "c"),
    ("system_table_folders", "fk_table_folders_parent_id", "parent_id", "system_table_folders", "id", "a"),
    ("system_table_folders", "system_table_folders_admin_user_id_fkey", "admin_user_id", "system_users", "id", "n"),
    ("system_table_row_view_counts", "fk_table_row_views_table_uid", "table_uid", "system_db_tables", "table_uid", "c"),
    ("system_table_row_view_counts", "fk_table_row_views_viewed_by_user_id", "viewed_by_user_id", "system_users", "id", "c"),
    ("system_transaction_log", "fk_system_transaction_log_function_id", "function_id", "system_functions", "id", "n"),
    ("system_user_group_memberships", "user_group_assignments_group_id_fkey", "group_id", "system_user_groups", "id", "c"),
    ("system_user_group_memberships", "user_group_assignments_user_id_fkey", "user_id", "system_users", "id", "c"),
)

# The ten tables as a site that never received the relationships has them: the
# columns the relationships need, the unique keys they point at, and nothing else.
GAP_SCHEMA = """
CREATE TABLE system_users (id bigint PRIMARY KEY, full_name text);
CREATE TABLE system_user_groups (id bigint PRIMARY KEY, name text);
CREATE TABLE system_functions (id bigint PRIMARY KEY, name text);
CREATE TABLE system_lang_keys (id bigint PRIMARY KEY, lang_key text);
CREATE TABLE system_table_views (id integer PRIMARY KEY, name text);
CREATE TABLE system_table_folders (
    id bigint PRIMARY KEY, folder_name text, parent_id integer, admin_user_id bigint);
CREATE TABLE system_db_tables (
    id bigint PRIMARY KEY, table_name text, table_uid integer,
    folder_id integer, default_view_id integer);
CREATE UNIQUE INDEX system_db_tables_table_uid_key ON system_db_tables (table_uid);
CREATE TABLE system_column_details (
    column_uid integer PRIMARY KEY, table_uid integer NOT NULL, column_name text);
CREATE TABLE system_column_control (id integer PRIMARY KEY, table_uid integer, column_uid integer);
CREATE TABLE system_foreign_key_relations_1_m (
    id integer PRIMARY KEY, source_table_uid integer, target_table_uid integer);
CREATE TABLE system_foreign_key_relations_m_m (
    id integer PRIMARY KEY, table_a_uid integer, table_b_uid integer, bridging_table_uid integer);
CREATE TABLE system_group_table_func_rights (
    id bigint PRIMARY KEY, user_group_id integer, function_id integer, target_table_uid integer);
CREATE TABLE system_lang_key_sources (id integer PRIMARY KEY, lang_key_id integer NOT NULL);
CREATE TABLE system_table_row_view_counts (
    id integer PRIMARY KEY, viewed_by_user_id integer, table_uid integer);
CREATE TABLE system_transaction_log (id bigint PRIMARY KEY, function_id integer);
CREATE TABLE system_user_group_memberships (
    id bigint PRIMARY KEY, user_id integer, group_id integer);
CREATE TABLE system_db_version (
    id bigserial PRIMARY KEY, version text, applied_at timestamptz DEFAULT now(), description text);
"""

# Rows the relationships must tolerate: a dataset in a folder with a default view,
# a group right on that dataset, and a membership.
GAP_ROWS = """
INSERT INTO system_users (id, full_name) VALUES (1, 'Reviewer');
INSERT INTO system_user_groups (id, name) VALUES (1, 'admin');
INSERT INTO system_functions (id, name) VALUES (1, 'dtt_1_row_read.GetResultsHandlerWrapper');
INSERT INTO system_lang_keys (id, lang_key) VALUES (1, 'dataset_title');
INSERT INTO system_table_views (id, name) VALUES (1, 'table_view');
INSERT INTO system_table_folders (id, folder_name, parent_id, admin_user_id) VALUES (1, 'database', NULL, 1);
INSERT INTO system_table_folders (id, folder_name, parent_id, admin_user_id) VALUES (2, 'apps', 1, NULL);
INSERT INTO system_db_tables (id, table_name, table_uid, folder_id, default_view_id)
VALUES (7, 'palvelukatalogi', 7, 2, 1);
INSERT INTO system_column_details (column_uid, table_uid, column_name) VALUES (70, 7, 'name');
INSERT INTO system_column_control (id, table_uid, column_uid) VALUES (1, 7, 70);
INSERT INTO system_group_table_func_rights (id, user_group_id, function_id, target_table_uid)
VALUES (1, 1, 1, 7);
INSERT INTO system_lang_key_sources (id, lang_key_id) VALUES (1, 1);
INSERT INTO system_user_group_memberships (id, user_id, group_id) VALUES (1, 1, 1);
"""

# Reads the relationships the way the production databases were read, so the test
# compares the same six facts the migration itself compares.
OBSERVE = """
SELECT child.relname || '|' || c.conname || '|' || child_column.attname || '|'
       || parent.relname || '|' || parent_column.attname || '|' || c.confdeltype::text
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class child ON child.oid = c.conrelid
  JOIN pg_catalog.pg_class parent ON parent.oid = c.confrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = child.relnamespace
  JOIN pg_catalog.pg_attribute child_column
    ON child_column.attrelid = c.conrelid AND child_column.attnum = c.conkey[1]
  JOIN pg_catalog.pg_attribute parent_column
    ON parent_column.attrelid = c.confrelid AND parent_column.attnum = c.confkey[1]
 WHERE c.contype = 'f' AND n.nspname = 'public'
   AND array_length(c.conkey, 1) = 1
   AND c.confupdtype = 'a' AND c.confmatchtype = 's'
   AND NOT c.condeferrable AND NOT c.condeferred AND c.convalidated
 ORDER BY 1;
"""


def observed(run, database):
    """The single-column foreign keys of one database as the EXPECTED tuples."""
    output = run(OBSERVE, database=database).stdout.strip()
    return tuple(tuple(line.split("|")) for line in output.splitlines() if line)


def test_bootstrap_runs_the_same_restoration_and_baselines_both_files():
    """A new installation must reach the same schema from the same text."""
    assert "20260926000001_restore_system_foreign_keys.sql" in GENERATOR.read_text()
    assert RESTORE.read_text() in (BOOTSTRAP / "schema.sql").read_text()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    assert_bootstrap_baseline(seed, RESTORE)
    assert_bootstrap_baseline(seed, RECORD)


def test_every_expected_relationship_is_named_in_the_migration():
    """The file states all twenty; nothing is restored by an unreviewed side path."""
    text = RESTORE.read_text()
    for _, constraint_name, _, _, _, _ in EXPECTED:
        assert f"'{constraint_name}'" in text, constraint_name
    assert text.count("-- VERSION_DB: 9.9.0") == 1
    # The restoration opened 9.9.0, and every later release carries it.
    assert _version((APP / "VERSION_DB").read_text().strip()) >= (9, 9, 0)


@pytest.fixture
def cluster():
    """Run SQL on a disposable Unix-socket-only cluster, never a live database."""
    if os.environ.get("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1":
        pytest.skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL checks")
    pg_bin = Path(os.environ.get("PG_TEST_BIN", "/usr/lib/postgresql/16/bin"))
    if not (pg_bin / "initdb").exists():
        pytest.skip("PostgreSQL test binaries unavailable")
    with tempfile.TemporaryDirectory(prefix="fk-restore-test-") as directory:
        base = Path(directory)
        data = base / "pgdata"
        socket = base / "socket"
        socket.mkdir(mode=0o700)
        subprocess.run([str(pg_bin / "initdb"), "-D", str(data), "-A", "trust", "-U", "test_owner",
                        "--no-locale", "--encoding=UTF8"], check=True, capture_output=True)
        subprocess.run([str(pg_bin / "pg_ctl"), "-D", str(data), "-l", str(base / "postgres.log"),
                        "-o", f"-h '' -k '{socket}' -p 15476", "-w", "start"],
                       check=True, capture_output=True)
        try:
            def run(sql, *, database="postgres", check=True):
                result = subprocess.run(
                    [str(pg_bin / "psql"), "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                     "-h", str(socket), "-p", "15476", "-U", "test_owner", "-d", database],
                    input=sql, text=True, capture_output=True,
                )
                if check and result.returncode != 0:
                    raise AssertionError(f"{database} failed: {result.stderr}")
                return result

            yield run
        finally:
            subprocess.run([str(pg_bin / "pg_ctl"), "-D", str(data), "-m", "fast", "-w", "stop"],
                           check=True, capture_output=True)


def _site_without_the_relationships(run, name, rows=GAP_ROWS):
    run(f"CREATE DATABASE {name};")
    run(GAP_SCHEMA + rows, database=name)
    assert observed(run, name) == ()
    return name


def _restore(run, database, check=True):
    result = run(RESTORE.read_text(), database=database, check=check)
    if result.returncode == 0:
        run(RECORD.read_text(), database=database)
    return result


def test_restoration_adds_all_twenty_with_their_names_and_delete_actions(cluster):
    _site_without_the_relationships(cluster, "gap")

    _restore(cluster, "gap")

    assert observed(cluster, "gap") == tuple(sorted(EXPECTED))
    assert cluster("SELECT count(*) FROM system_db_version WHERE version = '9.9.0';",
                   database="gap").stdout.strip() == "1"


def test_repeating_the_restoration_changes_nothing(cluster):
    _site_without_the_relationships(cluster, "gap")
    _restore(cluster, "gap")
    first = observed(cluster, "gap")

    _restore(cluster, "gap")

    assert observed(cluster, "gap") == first
    assert cluster("SELECT count(*) FROM system_db_version WHERE version = '9.9.0';",
                   database="gap").stdout.strip() == "1"


def test_a_same_name_constraint_that_means_something_else_stops_the_update(cluster):
    """A site whose schema disagrees must be looked at, not quietly passed over."""
    _site_without_the_relationships(cluster, "skew")
    # The same name, the same columns, but a delete that clears nothing.
    cluster("ALTER TABLE system_user_group_memberships"
            " ADD CONSTRAINT user_group_assignments_user_id_fkey"
            " FOREIGN KEY (user_id) REFERENCES system_users(id);", database="skew")
    before = observed(cluster, "skew")

    result = _restore(cluster, "skew", check=False)

    assert result.returncode != 0
    assert "states a different rule" in result.stderr
    assert "user_group_assignments_user_id_fkey" in result.stderr
    # The refusal is whole: not one of the other nineteen was added either.
    assert observed(cluster, "skew") == before
    assert cluster("SELECT count(*) FROM system_db_version WHERE version = '9.9.0';",
                   database="skew").stdout.strip() == "0"


def test_the_same_relationship_under_another_name_is_kept_without_a_duplicate(cluster):
    """PostgreSQL's own name for an unnamed reference already enforces the rule."""
    _site_without_the_relationships(cluster, "aliased")
    cluster("ALTER TABLE system_user_group_memberships"
            " ADD CONSTRAINT system_user_group_memberships_user_id_fkey"
            " FOREIGN KEY (user_id) REFERENCES system_users(id) ON DELETE CASCADE;",
            database="aliased")

    result = _restore(cluster, "aliased")

    assert "was not added" in result.stderr
    assert cluster(
        "SELECT count(*) FROM pg_constraint WHERE contype = 'f'"
        " AND conrelid = 'system_user_group_memberships'::regclass"
        " AND conkey = ARRAY[(SELECT attnum FROM pg_attribute"
        "   WHERE attrelid = 'system_user_group_memberships'::regclass"
        "     AND attname = 'user_id')]::int2[];",
        database="aliased").stdout.strip() == "1"


def test_a_row_pointing_at_nothing_stops_the_update_before_any_change(cluster):
    """The relationships are a claim about the rows; an update must not force it."""
    _site_without_the_relationships(
        cluster, "orphaned",
        rows=GAP_ROWS + "INSERT INTO system_user_group_memberships (id, user_id) VALUES (2, 999);")

    result = _restore(cluster, "orphaned", check=False)

    assert result.returncode != 0
    assert "violates foreign key constraint" in result.stderr
    assert observed(cluster, "orphaned") == ()


def test_a_new_installation_is_born_with_them_without_running_the_migration(cluster):
    """The reviewed public bootstrap alone must produce the same twenty."""
    cluster("CREATE DATABASE installed;")
    cluster((BOOTSTRAP / "schema.sql").read_text(), database="installed")
    cluster((BOOTSTRAP / "seed_data.sql").read_text(), database="installed")

    for child_table, constraint_name, child_column, parent_table, parent_column, action in EXPECTED:
        assert (child_table, constraint_name, child_column, parent_table, parent_column, action) \
            in observed(cluster, "installed"), constraint_name
    # The installation records the migrations as already embodied, so an upgrade
    # of a new site does not run them a second time.
    for name in (RESTORE.name, RECORD.name):
        assert cluster(f"SELECT count(*) FROM system_schema_migrations WHERE filename = '{name}';",
                       database="installed").stdout.strip() == "1", name
    # A new installation records the release it was generated at, 9.9.0 or later.
    current = (APP / "VERSION_DB").read_text().strip()
    assert _version(current) >= (9, 9, 0)
    assert cluster(f"SELECT count(*) FROM system_db_version WHERE version = '{current}';",
                   database="installed").stdout.strip() == "1"
