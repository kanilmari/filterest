"""test_bar_surface_language_seed.py
Verify the frosted-bars experiment switch's label seed (WL182, DB 9.13.9).
Connect the reviewed seed with the switch's language key and English fallback and the public bootstrap.
Keep source proofs database-free; the replay proof runs only where a disposable database is available.
"""
import hashlib
import json
from pathlib import Path
import re

from test_field_settings_language_seed import database  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / "server_tools/migrations/20261121000175_seed_bar_surface_language_keys.sql"
OWNER = "20261121000199_record_database_release_bar_surface.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
SWITCH = APP / "frontend/core_components/bar_surface/bar_surface_experiment.js"


def authored_rows():
    return re.findall(r"\('([^']+)', '((?:''|[^'])*)', '((?:''|[^'])*)', '([^']*)', '([^']*)', '([^']*)'\)",
                      MIGRATION.read_text())


def test_switch_label_seed_matches_the_switch_key_and_fallback():
    rows = authored_rows()
    assert [row[:3] for row in rows] == [
        ("bar_surface_frosted_experiment", "Huurretut palkit (kokeilu)", "Frosted bars (experiment)")]
    assert all(rows[0][3:])
    source = SWITCH.read_text()
    assert 'text.dataset.langKey = "bar_surface_frosted_experiment";' in source
    assert 'text.textContent = "Frosted bars (experiment)";' in source


def test_switch_label_seed_belongs_to_its_release_and_preserves_authored_copy():
    sql = MIGRATION.read_text()
    assert "-- VERSION_DB: 9.13.9" in sql
    assert f"-- VERSION_DB_OWNER: {OWNER}" in sql
    assert MIGRATION.name < OWNER
    assert "system_db_version" not in sql
    assert "WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END" in sql
    record = (MIGRATION.parent / OWNER).read_text()
    assert "SELECT '9.13.9'" in record and "WHERE NOT EXISTS" in record
    assert (APP / "VERSION_DB").read_text().strip() == "9.13.9"


def test_switch_label_is_embodied_and_hashed_in_fresh_bootstrap():
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    assert seed.count(MIGRATION.read_text()) == 1
    generator = (BOOTSTRAP / "generate_bootstrap.py").read_text()
    assert MIGRATION.name in re.search(r"language_seed_migrations = \((.*?)\n\)", generator, re.S)[1]
    assert OWNER in re.search(r"release_record_migrations = \((.*?)\n\)", generator, re.S)[1]
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    assert manifest["db_version"] == "9.13.9"
    ledger = manifest["migration_ledger_baseline"]
    assert ledger.index(MIGRATION.name) < ledger.index(OWNER)
    evidence = manifest["source_files"]["filterest/app/server_tools/migrations/" + MIGRATION.name]
    assert evidence["sha256"] == hashlib.sha256(MIGRATION.read_bytes()).hexdigest()


def test_switch_label_seed_replays_without_overwriting_reviewed_copy(database):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); INSERT INTO system_languages VALUES('fi'),('en');")
    key = "bar_surface_frosted_experiment"
    database(f"""INSERT INTO system_lang_keys(lang_key,fi,en,creation_spec)
        VALUES('{key}','Oma nimi','','reviewed');""")
    for _ in range(2):
        database(MIGRATION.read_text())
    assert database(f"SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='{key}'") == "Oma nimi|Frosted bars (experiment)"
    assert database(f"SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key='{key}'") == "2"
    assert database("SELECT count(*) FROM system_db_version") == "0"
