"""Verify the DB 9.8.1 deletion-log and filter-options repairs on install and upgrade.

Runs both migrations on disposable PostgreSQL clusters loaded from the reviewed
public bootstrap, as a new installation and rewound to an older site that lacks
the deletion log and the filter-options right of its readers. A fresh
installation and an upgraded one must end the same, a site that already has
the log keeps it, narrower rights stay narrow, and running again changes nothing.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from test_field_settings_language_seed import database  # noqa: F401  (disposable cluster fixture)

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
DELETION_LOG = MIGRATIONS / "20260922000002_create_missing_deletion_log.sql"
FILTER_OPTIONS = MIGRATIONS / "20260922000003_grant_filter_options_to_dataset_readers.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
WRITERS = ("admin_user", "basic_user")
FILTER_OPTIONS_RIGHT = "dtt_1_row_read.GetFilterOptionsHandler"

# The shape of the table, read from the catalog, without anything a site names itself.
LOG_SHAPE = """
SELECT json_build_array(
  (SELECT json_agg(json_build_array(attname, format_type(atttypid, atttypmod), attnotnull,
                                    pg_get_expr(adbin, adrelid)) ORDER BY attnum)
     FROM pg_attribute LEFT JOIN pg_attrdef ON adrelid = attrelid AND adnum = attnum
    WHERE attrelid = 'public.deletion_log'::regclass AND attnum > 0 AND NOT attisdropped),
  (SELECT json_agg(json_build_array(conname, pg_get_constraintdef(oid)) ORDER BY conname)
     FROM pg_constraint WHERE conrelid = 'public.deletion_log'::regclass))
"""
# Every group right on a dataset, by names rather than generated ids.
RIGHTS = """
SELECT coalesce(json_agg(json_build_array(groups.name, functions.name, tables.table_name)
                         ORDER BY groups.name, tables.table_name, functions.name), '[]')
  FROM system_group_table_func_rights AS rights
  JOIN system_user_groups AS groups ON groups.id = rights.user_group_id
  JOIN system_functions AS functions ON functions.id = rights.function_id
  JOIN system_db_tables AS tables ON tables.table_uid = rights.target_table_uid
"""
# The state of a site installed before 9.8.1: no deletion log, and readers of
# the demo datasets without the filter-options right.
OLDER_SITE = f"""
DROP TABLE public.deletion_log;
DELETE FROM system_group_table_func_rights AS rights
 USING system_functions AS functions, system_user_groups AS groups
 WHERE functions.id = rights.function_id AND groups.id = rights.user_group_id
   AND functions.name = '{FILTER_OPTIONS_RIGHT}' AND groups.name IN ('users', 'guests');
"""


@pytest.fixture
def site(database):  # noqa: F811  (the imported fixture is requested by name)
    """A disposable database installed from the reviewed public bootstrap, with the
    runtime roles that a role setup creates after the import."""
    database("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    database((BOOTSTRAP / "schema.sql").read_text())
    database((BOOTSTRAP / "seed_data.sql").read_text())
    for role in WRITERS:
        database(f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') "
                 f"THEN CREATE ROLE {role} NOLOGIN; END IF; END $$; GRANT USAGE ON SCHEMA public TO {role};")
    return database


def _upgrade(site):
    site(DELETION_LOG.read_text())
    site(FILTER_OPTIONS.read_text())


def _rights(site) -> list[list[str]]:
    return json.loads(site(RIGHTS))


def test_bootstrap_runs_the_log_repair_and_baselines_both_files():
    assert DELETION_LOG.name in (BOOTSTRAP / "generate_bootstrap.py").read_text()
    assert DELETION_LOG.read_text() in (BOOTSTRAP / "schema.sql").read_text()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    assert f"('{DELETION_LOG.name}')" in seed
    # A new installation already grants filter options with every reader
    # right, so the rights repair has nothing to do there: baselined only.
    assert f"('{FILTER_OPTIONS.name}')" in seed


def test_fresh_installation_equals_an_upgraded_one(site):
    fresh_shape, fresh_rights = site(LOG_SHAPE), _rights(site)
    site(OLDER_SITE)
    assert site("SELECT to_regclass('public.deletion_log') IS NULL") == "t"
    assert len(_rights(site)) < len(fresh_rights)

    _upgrade(site)

    assert site(LOG_SHAPE) == fresh_shape
    assert _rights(site) == fresh_rights


def test_upgrade_lets_both_writers_log_a_deletion(site):
    site(OLDER_SITE)
    _upgrade(site)

    for writer in WRITERS:
        assert site(f"SELECT has_table_privilege('{writer}', 'public.deletion_log', 'SELECT, INSERT')") == "t"
        assert site(f"SELECT has_sequence_privilege('{writer}', 'public.deletion_log_id_seq', 'USAGE')") == "t"
        # The same statement the delete path runs (deletion_log_writer.go), as that writer.
        site(f"SET ROLE {writer}; INSERT INTO deletion_log (table_name, record_id, deleted_by) "
             f"VALUES ('tiketit', '7', '{writer}') ON CONFLICT (table_name, record_id) DO NOTHING; RESET ROLE;")
    assert site("SELECT count(*) FROM deletion_log WHERE table_name = 'tiketit'") == "1"


def test_an_existing_log_keeps_its_rows_and_comment(site):
    site("""
        COMMENT ON TABLE deletion_log IS 'Site comment';
        INSERT INTO deletion_log (table_name, record_id, deleted_by, reason)
        VALUES ('tiketit', '1', 'admin', 'gdpr'), ('dokumentaatio', '2', 'system', NULL);
    """)
    before = site("SELECT json_agg(log ORDER BY id) FROM deletion_log AS log")

    site(DELETION_LOG.read_text())

    assert site("SELECT json_agg(log ORDER BY id) FROM deletion_log AS log") == before
    assert site("SELECT obj_description('public.deletion_log'::regclass, 'pg_class')") == "Site comment"


def test_a_site_without_runtime_roles_still_gets_the_log(database):  # noqa: F811
    # A new cluster has no runtime roles yet, as when the bootstrap is imported.
    database("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    assert database("SELECT count(*) FROM pg_roles WHERE rolname IN ('admin_user', 'basic_user')") == "0"

    database(DELETION_LOG.read_text())

    assert database("SELECT to_regclass('public.deletion_log') IS NOT NULL") == "t"


def test_only_groups_that_read_a_dataset_in_full_gain_filter_options(site):
    site(OLDER_SITE)
    # A group with a deliberately narrower set: it may search one dataset and
    # count its rows, but not list its columns or open its table view.
    site("""
        INSERT INTO system_user_groups (id, name) VALUES (9001, 'narrow_readers');
        INSERT INTO system_group_table_func_rights (user_group_id, function_id, target_table_uid)
        SELECT groups.id, functions.id, tables.table_uid
          FROM system_user_groups AS groups, system_functions AS functions, system_db_tables AS tables
         WHERE groups.name = 'narrow_readers' AND tables.table_name = 'tiketit'
           AND functions.name IN ('dtt_1_row_read.GetResultsHandlerWrapper',
                                  'dtt_1_row_read.GetRowCountHandlerWrapper');
    """)

    site(FILTER_OPTIONS.read_text())

    rights = _rights(site)
    assert ["narrow_readers", FILTER_OPTIONS_RIGHT, "tiketit"] not in rights
    for group in ("users", "guests"):
        assert [group, FILTER_OPTIONS_RIGHT, "tiketit"] in rights
    added = site(
        "SELECT count(*) FROM system_group_table_func_rights "
        "WHERE creation_spec = 'Filterest DB 9.8.1 filter-options right for groups that read the dataset'"
    )
    assert int(added) > 0


def test_running_again_changes_nothing(site):
    site(OLDER_SITE)
    _upgrade(site)
    first = site("SELECT json_build_array((SELECT json_agg(r ORDER BY r.id) FROM system_group_table_func_rights r),"
                 f"({LOG_SHAPE}), (SELECT relacl::text FROM pg_class WHERE oid = 'public.deletion_log'::regclass))")

    _upgrade(site)

    assert site("SELECT json_build_array((SELECT json_agg(r ORDER BY r.id) FROM system_group_table_func_rights r),"
                f"({LOG_SHAPE}), (SELECT relacl::text FROM pg_class WHERE oid = 'public.deletion_log'::regclass))") == first
