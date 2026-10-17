"""Prove WO41 setup-code copy and read-only suggestions on fresh and upgraded databases.

Connect the mixed schema/language migration to the reproducible public bootstrap.
Keep PostgreSQL replay, site-wording and version-owner proofs explicitly opt-in.
"""
import hashlib
import json
from pathlib import Path
import re

import pytest

from test_login_name_postgres import cluster, installed, upgrade, value  # noqa: F401

APP = Path(__file__).resolve().parents[2]
BOOTSTRAP = APP / "server_tools/public_bootstrap"
MIGRATIONS = APP / "server_tools/migrations"
MIGRATION = MIGRATIONS / "20261015000016_seed_first_run_setup_code.sql"
MARKER = "-- BOOTSTRAP_LANGUAGE_SEED\n"
KEYS = "('first_run_setup_code','first_run_setup_code_help')"
COPY = {
    "first_run_setup_code": ("Käyttöönottokoodi", "Setup code"),
    "first_run_setup_code_help": (
        "Syötä palvelimen lokissa tai asennuksen tai palautuksen tulosteessa näkyvä käyttöönottokoodi.",
        "Enter the setup code from the server log or the installation or recovery output.",
    ),
}


def test_first_run_code_packaging_and_read_only_body():
    sql = MIGRATION.read_text()
    schema, seed = sql.split(MARKER)
    owner = "20261015000099_record_database_release_9_12_0.sql"
    assert "-- VERSION_DB: 9.12.0" in schema
    assert f"-- VERSION_DB_OWNER: {owner}" in schema and MIGRATION.name < owner
    assert "system_db_version" not in sql
    assert "ALTER FUNCTION public.app_next_admin_display_name(text, text[]) STABLE;" in schema
    original = (MIGRATIONS / "20261005000011_separate_login_names.sql").read_text()
    body = original.split("CREATE OR REPLACE FUNCTION public.app_next_admin_display_name", 1)[1].split("$fn$;")[0]
    assert not re.search(r"\b(?:INSERT|UPDATE|DELETE|random|nextval|clock_timestamp|setval)\b", body, re.I)
    authored = re.search(r"WITH authored_keys\(lang_key, fi, en\) AS \(VALUES(.*?)\n\),", seed, re.S)[1]
    assert {key: (fi, en) for key, fi, en in re.findall(r"\('([^']+)', '([^']+)', '([^']+)'\)", authored)} == COPY
    assert "('fi', s.fi), ('en', s.en)" in seed
    assert schema in (BOOTSTRAP / "schema.sql").read_text()
    assert seed in (BOOTSTRAP / "seed_data.sql").read_text()
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    assert MIGRATION.name in manifest["migration_ledger_baseline"]
    assert manifest["source_files"]["filterest/app/server_tools/migrations/" + MIGRATION.name]["sha256"] == hashlib.sha256(MIGRATION.read_bytes()).hexdigest()
    version = (APP / "VERSION_DB").read_text().strip()
    assert (APP / f"server_tools/versioning/schema_snapshots/db-{version}.sql").read_bytes() == (BOOTSTRAP / "schema.sql").read_bytes()


def copy_shape(run):
    return value(run, f"""SELECT jsonb_agg(jsonb_build_array(
        k.lang_key,k.fi,k.en,t.language_code,t.translation,t.source_kind,t.review_status)
        ORDER BY k.lang_key,t.language_code)
        FROM system_lang_keys k JOIN system_lang_key_translations t ON t.lang_key_id=k.id
        WHERE k.lang_key IN {KEYS}""")


def language_snapshot(run):
    return value(run, """SELECT jsonb_build_array(
        (SELECT jsonb_agg(k ORDER BY id) FROM system_lang_keys k),
        (SELECT jsonb_agg(t ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t),
        (SELECT jsonb_agg(s ORDER BY lang_key_id,source_type,source_high) FROM system_lang_key_sources s),
        (SELECT jsonb_agg(r ORDER BY id) FROM system_data_repair_records r),
        (SELECT jsonb_agg(v ORDER BY id) FROM system_db_version v))""")


def test_first_run_code_upgrade_matches_fresh_and_replay_is_idempotent(installed, upgrade):
    # Start at the existing historical fixture, then replay the real upgrade
    # order up to 000016. The 9.12.0 release owner deliberately has not run yet.
    for migration in sorted(MIGRATIONS.glob("*.sql")):
        if "20260929000006" < migration.name <= MIGRATION.name:
            upgrade(migration.read_text())
    assert value(upgrade, "SELECT count(*) FROM system_db_version WHERE version='9.12.0'") == "0"
    assert value(installed, "SELECT count(*) FROM system_db_version WHERE version='9.12.0'") == "1"
    initial = copy_shape(installed)
    assert len(json.loads(initial)) == 4
    assert copy_shape(upgrade) == initial
    for run in (installed, upgrade):
        assert value(run, "SELECT provolatile FROM pg_proc WHERE oid='public.app_next_admin_display_name(text,text[])'::regprocedure") == "s"
        assert value(run, f"SELECT count(*) FROM system_lang_key_sources s JOIN system_lang_keys k ON k.id=s.lang_key_id "
                     f"WHERE k.lang_key IN {KEYS} AND s.source_high='frontend/templates/first_run_admin.html' "
                     "AND NULLIF(btrim(s.usage_explanation),'') IS NOT NULL") == "2"
        before = language_snapshot(run)
        for _ in range(2):
            run(MIGRATION.read_text())
            assert language_snapshot(run) == before
            assert copy_shape(run) == initial
    owner = MIGRATIONS / "20261015000099_record_database_release_9_12_0.sql"
    upgrade(owner.read_text())
    upgrade(owner.read_text())
    assert value(upgrade, "SELECT count(*) FROM system_db_version WHERE version='9.12.0'") == "1"


@pytest.mark.parametrize("store", ["columns", "normalized", "both"])
def test_first_run_code_preserves_existing_copy_in_both_stores(installed, store):
    run = installed
    # Distinct nonblank values in both stores must each survive, even when
    # they disagree. A missing store inherits the site's other stored wording.
    fi, en = ("  Sivuston koodi  ", "  Site code  ") if store != "normalized" else ("", " ")
    nfi, nen = ("  Oma ohje  ", "  Site help  ") if store != "columns" else (" ", "")
    run(f"UPDATE system_lang_keys SET fi='{fi}',en='{en}',ch='Site Chinese' WHERE lang_key IN {KEYS}")
    # The normalized store forbids blank translations (CHECK btrim(translation) <> ''), so a blank store means no row.
    if store == "columns":
        run(f"""DELETE FROM system_lang_key_translations t USING system_lang_keys k
            WHERE k.id=t.lang_key_id AND k.lang_key IN {KEYS} AND language_code IN ('fi','en')""")
    else:
        run(f"""UPDATE system_lang_key_translations t
            SET translation=CASE language_code WHEN 'fi' THEN '{nfi}' ELSE '{nen}' END,
                source_kind='manual',review_status='approved'
            FROM system_lang_keys k WHERE k.id=t.lang_key_id AND k.lang_key IN {KEYS}
            AND language_code IN ('fi','en')""")
    # Chinese is language code zh-CN in system_languages; the legacy column is still named ch.
    run(f"""INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
        SELECT id,'zh-CN','Site Chinese','manual','approved' FROM system_lang_keys WHERE lang_key IN {KEYS}
        ON CONFLICT (lang_key_id, language_code) DO UPDATE SET translation=EXCLUDED.translation""")
    run(MIGRATION.read_text())
    for key in COPY:
        expected_columns = [fi, en] if store != "normalized" else [nfi, nen]
        expected_normalized = [nfi, nen] if store != "columns" else [fi, en]
        assert json.loads(value(run, f"SELECT jsonb_build_array(fi,en) FROM system_lang_keys WHERE lang_key='{key}'")) == expected_columns
        assert json.loads(value(run, f"SELECT jsonb_agg(translation ORDER BY language_code DESC) "
                                f"FROM system_lang_key_translations WHERE language_code IN ('fi','en') "
                                f"AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='{key}')")) == expected_normalized
    assert value(run, f"SELECT count(*) FROM system_lang_keys WHERE lang_key IN {KEYS} AND ch='Site Chinese'") == "2"
    assert value(run, f"SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id "
                 f"WHERE k.lang_key IN {KEYS} AND language_code='zh-CN' AND translation='Site Chinese'") == "2"
    before = language_snapshot(run)
    run(MIGRATION.read_text())
    assert language_snapshot(run) == before
