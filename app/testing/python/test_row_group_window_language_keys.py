"""Verify repeatable fi/en window copy and fresh/upgrade bootstrap equality.

Connects migration 000038 to the generator class, audit policy and editor keys.
Disposable PostgreSQL checks are opt-in and skip before database access.
"""
import json
from pathlib import Path
import re

from test_field_settings_language_seed import database  # noqa: F401
from test_row_actor_support import cluster, installed, upgrade, value  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
MIGRATION = MIGRATIONS / "20261005000038_seed_row_group_window_language_keys.sql"


def authored_keys():
    return {key: (fi.replace("''", "'"), en.replace("''", "'")) for key, fi, en in re.findall(
        r"\('(row_group_window_[^']+)', '((?:''|[^'])*)', '((?:''|[^'])*)'\)", MIGRATION.read_text())}


def test_window_copy_in_bootstrap_and_every_editor_key_has_fi_en():
    keys = authored_keys()
    assert len(keys) == 18
    assert all(fi and en for fi, en in keys.values())
    source = (APP / "frontend/core_components/admin_tools/row_group_assignment_editor.js").read_text()
    used = set(re.findall(r'"(row_group_window_[^"`]+)"', source))
    used.update(("row_group_window_name_fi", "row_group_window_name_en"))
    assert used == set(keys)
    assert "-- VERSION_DB: 9.10.0" in MIGRATION.read_text()
    assert "-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql" in MIGRATION.read_text()
    generator = (BOOTSTRAP / "generate_bootstrap.py").read_text()
    language_class = re.search(r"language_seed_migrations = \((.*?)\n\)", generator, re.S)[1]
    assert MIGRATION.name in language_class
    assert MIGRATION.read_text() in (BOOTSTRAP / "seed_data.sql").read_text()
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    assert MIGRATION.name in manifest["migration_ledger_baseline"]
    policy = (APP / "server_tools/public_slice_export/public_bootstrap_policy.py").read_text()
    assert '"classification window copy": "row_group_window_new_heading"' in policy
    assert '"classification window recoverable error": "row_group_window_save_failed"' in policy
    assert (BOOTSTRAP / "schema.sql").read_bytes() == (APP / "server_tools/versioning/schema_snapshots/db-9.10.0.sql").read_bytes()


def test_window_migration_twice_preserves_reviewed_copy(database):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); INSERT INTO system_languages VALUES('fi'),('en');")
    database("""INSERT INTO system_lang_keys(lang_key,fi,en,creation_spec)
        VALUES('row_group_window_mixed','Oma ilmaus','','oma');
        INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
        SELECT id,'fi','Tarkistettu','manual','approved' FROM system_lang_keys WHERE lang_key='row_group_window_mixed';""")
    for _ in range(2):
        database(MIGRATION.read_text())
    keys = ",".join(f"'{key}'" for key in authored_keys())
    assert database(f"SELECT count(*) FROM system_lang_keys WHERE lang_key IN ({keys})") == "18"
    assert database(f"SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key IN ({keys}) AND language_code IN ('fi','en') AND review_status='approved'") == "36"
    assert database("SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='row_group_window_mixed'") == "Oma ilmaus|On some rows"
    assert database("SELECT translation FROM system_lang_key_translations WHERE language_code='fi' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='row_group_window_mixed')") == "Tarkistettu"


def test_window_fresh_bootstrap_equals_upgrade_and_repeat(installed, upgrade):
    for migration in sorted(MIGRATIONS.glob("202610050000*.sql")):
        upgrade(migration.read_text())
    keys = ",".join(f"'{key}'" for key in authored_keys())
    query = f"""SELECT jsonb_agg(jsonb_build_array(k.lang_key,k.fi,k.en,t.language_code,t.translation,t.review_status)
        ORDER BY k.lang_key,t.language_code) FROM system_lang_keys k
        JOIN system_lang_key_translations t ON t.lang_key_id=k.id
        WHERE k.lang_key IN ({keys}) AND t.language_code IN ('fi','en')"""
    initial = value(installed, query)
    assert initial == value(upgrade, query)
    assert len(json.loads(initial)) == 36
    for run in (installed, upgrade):
        for _ in range(2):
            run(MIGRATION.read_text())
            assert value(run, query) == initial
