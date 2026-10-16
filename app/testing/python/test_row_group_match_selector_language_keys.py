"""test_row_group_match_selector_language_keys.py
Verify selector copy, exact-seed replacement and bootstrap parity.
Connect the DB 9.12.0 wording migration to its owning frontend catalogue.
Keep packaging offline and PostgreSQL replay proofs explicitly opt-in.
"""
import json
from pathlib import Path
import re

import pytest

from test_field_settings_language_seed import database  # noqa: F401
from test_row_actor_support import cluster, installed, upgrade, value  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / "server_tools/migrations/20261015000005_seed_row_group_match_selector_language_keys.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
COPY = {
    "row_group_match_legend": ("Kun valitset useita", "When you select several"),
    "row_group_match_any_effect": ("Enemmän tuloksia", "More results"),
    "row_group_match_all_effect": ("Vähemmän tuloksia", "Fewer results"),
    "row_group_match_help_label": ("Selitä valintojen yhdistäminen", "Explain how selections combine"),
    "row_group_match_headings_hint": ("Eri otsikoiden valinnat rajaavat hakua aina yhdessä.",
                                    "Selections under different headings always narrow the search together."),
    "row_group_match_any": ("Mikä tahansa käy", "Accept any"),
    "row_group_match_all": ("Kaikki vaaditaan", "Require all"),
}
OLD = {"row_group_match_any": ("Vähintään yksi", "At least one"),
       "row_group_match_all": ("Kaikki valitut", "All selected")}


def test_selector_copy_catalogue_and_release_packaging():
    sql = MIGRATION.read_text()
    authored = re.search(r"WITH authored_keys\(lang_key, fi, en\) AS \(VALUES(.*?)\n\),", sql, re.S)[1]
    assert dict((key, (fi, en)) for key, fi, en in re.findall(
        r"\('(row_group_[^']+)', '([^']+)', '([^']+)'\)", authored)) == COPY
    source = (APP / "frontend/core_components/filterbar/filter_list/row_group_facet_card_builder.js").read_text()
    assert "MATCH_MODE_COPY = Object.freeze" in source
    assert all(re.search(r"\w*[Kk]ey:\s*'" + key + "'", source) for key in COPY)
    assert "row_group_match_mode" not in source
    assert "-- VERSION_DB: 9.12.0" in sql
    owner = "20261015000099_record_database_release_9_12_0.sql"
    assert f"-- VERSION_DB_OWNER: {owner}" in sql and MIGRATION.name < owner
    assert "system_db_version" not in sql
    assert "DELETE FROM public.system_lang_keys" not in sql
    assert "keys.fi = superseded.fi" in sql and "keys.en = superseded.en" in sql
    assert "stored.translation = superseded.fi" in sql and "stored.translation = superseded.en" in sql
    assert "('fi', s.fi), ('en', s.en)" in sql
    assert "'manual', 'approved'" in sql and "usage_explanation" in sql
    assert "ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING" in sql
    assert sql in (BOOTSTRAP / "seed_data.sql").read_text()
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    assert MIGRATION.name in manifest["migration_ledger_baseline"]
    generator = (BOOTSTRAP / "generate_bootstrap.py").read_text()
    assert MIGRATION.name in re.search(r"language_seed_migrations = \((.*?)\n\)", generator, re.S)[1]


def snapshot(database):
    return database("""SELECT jsonb_build_array(
        (SELECT jsonb_agg(k ORDER BY lang_key) FROM system_lang_keys k),
        (SELECT jsonb_agg(t ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t),
        (SELECT jsonb_agg(s ORDER BY lang_key_id,source_type,source_high) FROM system_lang_key_sources s))""")


def test_exact_seed_is_reworded_in_both_stores_and_replay_changes_nothing(database):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); INSERT INTO system_languages VALUES('fi'),('en');")
    database((APP / "server_tools/migrations/20261007000001_seed_row_group_match_mode_language_keys.sql").read_text())
    database(MIGRATION.read_text())
    for key, (fi, en) in COPY.items():
        assert database(f"SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='{key}'") == f"{fi}|{en}"
        assert database(f"SELECT string_agg(translation,'|' ORDER BY language_code DESC) FROM system_lang_key_translations "
                        f"WHERE lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='{key}')") == f"{fi}|{en}"
    assert database("SELECT count(*) FROM system_lang_key_sources WHERE NULLIF(btrim(usage_explanation),'') IS NOT NULL") == "7"
    # Removing the code reference never deletes the stored retired key.
    assert database("SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='row_group_match_mode'") == "Hakutapa|Match mode"
    before = snapshot(database)
    database(MIGRATION.read_text())
    assert snapshot(database) == before
    assert database("SELECT count(*) FROM system_db_version") == "0"


@pytest.mark.parametrize("store", ["columns", "normalized", "both"])
def test_site_wording_survives_in_each_store_and_fills_empty_copy(database, store):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); INSERT INTO system_languages VALUES('fi'),('en');")
    for key in OLD:
        fi, en = ("Oma hakutapa", "My wording") if store != "normalized" else ("", "")
        database(f"INSERT INTO system_lang_keys(lang_key,fi,en,creation_spec) VALUES('{key}','{fi}','{en}','site context')")
        if store != "columns":
            database(f"""INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
                SELECT id,copy.code,copy.text,'manual','approved' FROM system_lang_keys
                CROSS JOIN (VALUES('fi','Oma hakutapa'),('en','My wording')) copy(code,text) WHERE lang_key='{key}'""")
    # A whitespace-bearing near-match is site copy, not the exact superseded seed.
    database("INSERT INTO system_lang_keys(lang_key,fi,en) VALUES('row_group_match_legend',' Kun valitset useita ','Site legend')")
    database(MIGRATION.read_text())
    for key in OLD:
        assert database(f"SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='{key}'") == "Oma hakutapa|My wording"
        assert database(f"SELECT translation FROM system_lang_key_translations WHERE language_code='fi' "
                        f"AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='{key}')") == "Oma hakutapa"
    # Brackets keep the spaces: the shared fixture strips psql output.
    assert database("SELECT '['||fi||']' FROM system_lang_keys WHERE lang_key='row_group_match_legend'") == "[ Kun valitset useita ]"
    before = snapshot(database)
    database(MIGRATION.read_text())
    assert snapshot(database) == before


@pytest.mark.parametrize("key", OLD)
def test_seed_rewording_is_independent_of_site_edits_in_the_other_store(database, key):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); INSERT INTO system_languages VALUES('fi'),('en');")
    fi, en = OLD[key]
    database(f"INSERT INTO system_lang_keys(lang_key,fi,en) VALUES('{key}','{fi}','Custom column')")
    database(f"""INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
        SELECT id,copy.code,copy.text,'manual','approved' FROM system_lang_keys
        CROSS JOIN (VALUES('fi','Custom normalized'),('en','{en}')) copy(code,text) WHERE lang_key='{key}'""")
    database(MIGRATION.read_text())
    assert database(f"SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='{key}'") == "Custom normalized|Custom column"
    assert database(f"SELECT string_agg(translation,'|' ORDER BY language_code DESC) FROM system_lang_key_translations "
                    f"WHERE lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='{key}')") == "Custom normalized|Custom column"


def test_near_seed_wording_and_other_languages_are_preserved(database):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); INSERT INTO system_languages VALUES('fi'),('en'),('ch');")
    database("""INSERT INTO system_lang_keys(lang_key,fi,en,ch) VALUES
        ('row_group_match_any',' Vähintään yksi ','At least one.','Site Chinese');
        INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
        SELECT id,copy.code,copy.text,'automatic','pending' FROM system_lang_keys
        CROSS JOIN (VALUES('fi','Vähintään yksi '),('en','At least one!'),('ch','Site Chinese')) copy(code,text)
        WHERE lang_key='row_group_match_any';""")
    query = """SELECT jsonb_agg(jsonb_build_array(k.fi,k.en,k.ch,t.language_code,t.translation,t.source_kind,t.review_status)
        ORDER BY t.language_code) FROM system_lang_keys k JOIN system_lang_key_translations t ON t.lang_key_id=k.id
        WHERE k.lang_key='row_group_match_any'"""
    before = database(query)
    database(MIGRATION.read_text())
    assert database(query) == before
    assert database("SELECT count(*) FROM system_lang_key_translations WHERE language_code='ch'") == "1"


def test_selector_fresh_bootstrap_equals_upgrade_and_repeat(installed, upgrade):
    migrations = APP / "server_tools/migrations"
    for migration in sorted(migrations.glob("202610050000*.sql")):
        upgrade(migration.read_text())
    upgrade((migrations / "20261007000001_seed_row_group_match_mode_language_keys.sql").read_text())
    upgrade(MIGRATION.read_text())
    keys = ",".join(f"'{key}'" for key in COPY)
    query = f"""SELECT jsonb_agg(jsonb_build_array(k.lang_key,k.fi,k.en,t.language_code,t.translation,t.source_kind,t.review_status)
        ORDER BY k.lang_key,t.language_code) FROM system_lang_keys k JOIN system_lang_key_translations t ON t.lang_key_id=k.id
        WHERE k.lang_key IN ({keys}) AND t.language_code IN ('fi','en')"""
    initial = value(installed, query)
    assert len(json.loads(initial)) == 14
    assert value(upgrade, query) == initial
    for run in (installed, upgrade):
        for _ in range(2):
            run(MIGRATION.read_text())
            assert value(run, query) == initial
