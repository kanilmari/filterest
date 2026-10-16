"""test_translation_object_sources.py
Check the additive ownership repair and fresh-install/upgrade equivalence.
Connect migration 000006 to bootstrap classification, evidence and real SQL.
Keep PostgreSQL opt-in; ordinary checks need neither a database nor credentials.
"""
import json
from pathlib import Path

from test_row_actor_support import cluster  # noqa: F401

APP = Path(__file__).resolve().parents[2]
NAME = "20261015000006_backfill_translation_object_sources.sql"
MIGRATION = APP / "server_tools/migrations" / NAME
BOOTSTRAP = APP / "server_tools/public_bootstrap"


def test_translation_backfill_is_additive_and_registered_before_release():
    source = MIGRATION.read_text()
    generator = (BOOTSTRAP / "generate_bootstrap.py").read_text()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    assert "-- VERSION_DB: 9.12.0" in source
    assert "-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql" in source
    assert NAME < "20261015000099_record_database_release_9_12_0.sql"
    assert generator.count('"' + NAME + '"') == 1
    assert source in seed
    assert "ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING" in source
    assert not any(word in source.upper() for word in ("DELETE FROM", "DROP TABLE", "UPDATE PUBLIC.SYSTEM_LANG_KEY_SOURCES"))
    assert "associated keys before=%, after=%" in source
    assert "unresolved object key (withheld from non-admin translations): %" in source


def source_state(cluster, database):
    return json.loads(cluster("""
        SELECT COALESCE(jsonb_agg(to_jsonb(source) ORDER BY lang_key, source_type, source_high), '[]')
        FROM (SELECT keys.lang_key, sources.source_type, sources.source_high,
                     sources.source_low, sources.usage_explanation
              FROM system_lang_key_sources sources
              JOIN system_lang_keys keys ON keys.id=sources.lang_key_id) source
    """, database).stdout)


def test_translation_backfill_fresh_install_equals_upgrade_postgres(cluster):
    source = MIGRATION.read_text()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    # A fresh installation runs the complete generated acceptance block. The
    # upgrade starts with identical seed inputs before this data repair existed.
    for database in ("sec2_fresh", "sec2_upgrade"):
        cluster("CREATE DATABASE " + database)
        cluster((BOOTSTRAP / "schema.sql").read_text(), database)
    fresh = cluster(seed, "sec2_fresh")
    before_acceptance = seed[:seed.index("DO $filterest_acceptance$")]
    assert before_acceptance.count(source) == 1
    cluster(before_acceptance.replace(source, ""), "sec2_upgrade")
    upgrade = cluster(source, "sec2_upgrade")
    assert "WO-SEC2 associated keys before=" in fresh.stderr
    assert "WO-SEC2 associated keys before=" in upgrade.stderr
    expected = source_state(cluster, "sec2_fresh")
    assert expected == source_state(cluster, "sec2_upgrade")
    assert any(row["source_type"] == "table" for row in expected)
    assert any(row["source_type"] == "column" for row in expected)
    assert any(row["source_type"] == "folder" for row in expected)
    cluster(source, "sec2_upgrade")
    assert expected == source_state(cluster, "sec2_upgrade")
    assert cluster("SELECT count(*) FROM system_data_repair_records WHERE migration='translation_object_sources_sec2' AND action='completed'", "sec2_upgrade").stdout.strip() == "1"
