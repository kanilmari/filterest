"""test_admin_version_info_language_keys.py
Verify release-check copy, bootstrap packaging and translation preservation.
Connect the reviewed DB 9.10.2 seed with shared frontend language-key readers.
Keep source proofs database-free and executable replay explicitly opt-in.
"""
import hashlib
import json
from pathlib import Path
import re

from test_field_settings_language_seed import database  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / "server_tools/migrations/20261009000002_seed_admin_version_info_language_keys.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
FRONTEND = APP / "frontend/core_components/admin_tools"
OWNER = "20261009000099_record_database_release_9_10_2.sql"


def authored_keys():
    return {key: (fi, en) for key, fi, en in re.findall(
        r"\('([^']+)', '((?:''|[^'])*)', '((?:''|[^'])*)'\)", MIGRATION.read_text())}


def test_reviewed_release_check_copy_matches_frontend_fallbacks_and_key_reader():
    keys = authored_keys()
    assert len(keys) == 6
    assert keys["admin_version_info_check_releases"] == ("Tarkista julkaisut", "Check releases")
    assert keys["admin_version_info_required_by_running_app"] == (
        "Käynnissä olevan sovelluksen vaatima", "Required by the running application")
    assert keys["admin_version_info_site_operator_updates"] == (
        "Päivitykset tekee toistaiseksi sivuston ylläpitäjä palvelimella.",
        "Updates are currently performed by the site operator.")
    copy = (FRONTEND / "admin_version_info_translation_fallbacks.js").read_text()
    mapping = re.search(r"ADMIN_VERSION_INFO_COPY_KEYS = Object.freeze\(\{(.*?)\}\)", copy, re.S)[1]
    assert set(re.findall(r'"(admin_version_info_[^"]+)"', mapping)) == set(keys)
    for key, values in keys.items():
        block = re.search(r"\b" + key + r": \{(.*?)\n    \},", copy, re.S)[1]
        fallback = tuple(json.loads(re.search(r"\b" + language + r': ("(?:[^"\\]|\\.)*")', block)[1])
                         for language in ("fi", "en"))
        assert fallback == values
    formatter = (FRONTEND / "admin_version_info_formatter.js").read_text()
    assert "getTranslationForKey(key, { fallback:" in formatter
    indicator = (FRONTEND / "admin_version_info_indicator.js").read_text()
    assert "bindDatasetLanguageRenderer(shell," in indicator


def test_release_check_migration_joins_unreleased_9102_before_its_owner():
    sql = MIGRATION.read_text()
    assert "-- VERSION_DB: 9.10.2" in sql
    assert f"-- VERSION_DB_OWNER: {OWNER}" in sql
    assert MIGRATION.name < OWNER
    assert "system_db_version" not in sql
    assert "UPDATE" not in sql and "ON CONFLICT" not in sql
    assert "NOT EXISTS" in sql
    assert "'manual', 'approved'" in sql
    assert "('fi', served.fi), ('en', served.en)" in sql


def test_release_check_copy_is_embodied_and_hashed_in_fresh_bootstrap():
    sql = MIGRATION.read_text()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    assert seed.count(sql) == 1
    generator = (BOOTSTRAP / "generate_bootstrap.py").read_text()
    assert MIGRATION.name in re.search(r"language_seed_migrations = \((.*?)\n\)", generator, re.S)[1]
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    assert manifest["db_version"] == (APP / "VERSION_DB").read_text().strip() == "9.10.2"
    ledger = manifest["migration_ledger_baseline"]
    assert ledger.index(MIGRATION.name) < ledger.index(OWNER)
    evidence = manifest["source_files"]["filterest/app/server_tools/migrations/" + MIGRATION.name]
    assert evidence["sha256"] == hashlib.sha256(MIGRATION.read_bytes()).hexdigest()
    assert manifest["generated_files"]["server_tools/public_bootstrap/seed_data.sql"]["sha256"] == hashlib.sha256(
        (BOOTSTRAP / "seed_data.sql").read_bytes()).hexdigest()


def test_release_check_seed_replays_without_overwriting_reviewed_copy(database):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); INSERT INTO system_languages VALUES('fi'),('en');")
    key = "admin_version_info_check_releases"
    database(f"""INSERT INTO system_lang_keys(lang_key,fi,en,creation_spec)
        VALUES('{key}','Oma tarkistus','My check','reviewed');
        INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
        SELECT id,'fi','Tarkistettu käännös','manual','approved' FROM system_lang_keys WHERE lang_key='{key}';""")
    for _ in range(2):
        database(MIGRATION.read_text())
    keys = ",".join(f"'{name}'" for name in authored_keys())
    assert database(f"SELECT count(*) FROM system_lang_keys WHERE lang_key IN ({keys})") == "6"
    assert database(f"SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key IN ({keys}) AND language_code IN ('fi','en')") == "12"
    assert database(f"SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='{key}'") == "Oma tarkistus|My check"
    assert database(f"SELECT translation FROM system_lang_key_translations WHERE language_code='fi' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='{key}')") == "Tarkistettu käännös"
    assert database("SELECT count(*) FROM system_db_version") == "0"
