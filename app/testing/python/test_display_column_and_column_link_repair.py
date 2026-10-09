"""Verify the DB 9.9.1 repair of stale display-column settings and the column-metadata link name.

Runs 20260929000002 on disposable PostgreSQL clusters loaded from the reviewed public
bootstrap, shaped like a site installed from an older public bootstrap: its
system_table_views setting names a column the table never had, and its link from
column metadata to the dataset registry carries the name PostgreSQL generates.
Proves a new installation needs no repair, the repair clears only settings naming a
missing column and renames only a link that states the expected rule, a link with
another rule stops the whole file, and running it again changes nothing.
"""
from __future__ import annotations

from pathlib import Path
import subprocess

import pytest

from bootstrap_contract_assertions import assert_bootstrap_baseline
from test_field_settings_language_seed import database  # noqa: F401  (disposable cluster fixture)

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / "server_tools/migrations/20260929000002_clear_missing_display_columns_and_name_column_link.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
CANONICAL = "fk_system_column_details_table_uid"
GENERATED = "system_column_details_table_uid_fkey"
# Settings that name a column their table lacks, as the reader sees them.
STALE_SETTINGS = """
    SELECT coalesce(string_agg(t.table_name || '.' || t.fk_display_column, ',' ORDER BY t.table_name), '')
      FROM public.system_db_tables t
     WHERE COALESCE(t.fk_display_column, '') <> ''
       AND to_regclass(format('%I.%I', COALESCE(NULLIF(t.schema_name, ''), 'public'), t.table_name)) IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid = to_regclass(format('%I.%I', COALESCE(NULLIF(t.schema_name, ''), 'public'), t.table_name))
                AND a.attname = t.fk_display_column AND a.attnum > 0 AND NOT a.attisdropped)
"""
LINKS = """
    SELECT string_agg(conname || ' ' || pg_get_constraintdef(oid), ';' ORDER BY conname)
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.system_column_details'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (table_uid)%'
"""
SETTINGS = """
    SELECT string_agg(table_name || '=' || COALESCE(fk_display_column, '(none)'), ',' ORDER BY table_name)
      FROM public.system_db_tables
"""


def _run_as_the_application_does(run):
    """One migration file runs in one transaction, as the startup runner applies it."""
    run("BEGIN;\n" + MIGRATION.read_text() + "\nCOMMIT;")


def _older_site(run):
    run(f"""
        UPDATE public.system_db_tables SET fk_display_column = 'view_name' WHERE table_name = 'system_table_views';
        ALTER TABLE public.system_column_details RENAME CONSTRAINT {CANONICAL} TO {GENERATED};
    """)


@pytest.fixture
def site(database):  # noqa: F811  (the imported fixture is requested by name)
    """A disposable database installed from the reviewed public bootstrap."""
    database("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    database((BOOTSTRAP / "schema.sql").read_text())
    database((BOOTSTRAP / "seed_data.sql").read_text())
    return database


def test_the_bootstrap_records_the_repair_as_embodied():
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    assert_bootstrap_baseline(seed, MIGRATION)
    # A new installation is born correct, so the bootstrap does not run the repair.
    assert MIGRATION.read_text() not in seed
    assert MIGRATION.read_text() not in (BOOTSTRAP / "schema.sql").read_text()


def test_new_installation_has_no_setting_naming_a_missing_column_and_the_canonical_link(site):
    assert site(STALE_SETTINGS) == ""
    assert site(LINKS) == f"{CANONICAL} FOREIGN KEY (table_uid) REFERENCES system_db_tables(table_uid) ON DELETE CASCADE"


def test_the_repair_clears_only_the_stale_setting_and_renames_the_generated_link(site):
    _older_site(site)
    assert site(STALE_SETTINGS) == "system_table_views.view_name"
    before = site(SETTINGS)

    _run_as_the_application_does(site)

    assert site(STALE_SETTINGS) == ""
    assert site(SETTINGS) == before.replace("system_table_views=view_name", "system_table_views=(none)")
    assert site(LINKS) == f"{CANONICAL} FOREIGN KEY (table_uid) REFERENCES system_db_tables(table_uid) ON DELETE CASCADE"


def test_running_again_changes_nothing(site):
    _older_site(site)
    _run_as_the_application_does(site)
    settings, links = site(SETTINGS), site(LINKS)
    stamps = site("SELECT string_agg(table_name || updated::text, ',' ORDER BY table_name) FROM public.system_db_tables")

    _run_as_the_application_does(site)

    assert (site(SETTINGS), site(LINKS)) == (settings, links)
    assert site("SELECT string_agg(table_name || updated::text, ',' ORDER BY table_name) FROM public.system_db_tables") == stamps


def test_a_generated_link_with_another_rule_stops_the_whole_file(site):
    _older_site(site)
    site(f"""
        ALTER TABLE public.system_column_details DROP CONSTRAINT {GENERATED};
        ALTER TABLE public.system_column_details ADD CONSTRAINT {GENERATED}
            FOREIGN KEY (table_uid) REFERENCES public.system_db_tables(table_uid);
    """)

    with pytest.raises(subprocess.CalledProcessError) as refused:
        _run_as_the_application_does(site)

    assert "states a different rule" in refused.value.stderr
    # Nothing of the file stays: the stale setting and the other link are as they were.
    assert site(STALE_SETTINGS) == "system_table_views.view_name"
    assert site(LINKS) == f"{GENERATED} FOREIGN KEY (table_uid) REFERENCES system_db_tables(table_uid)"
