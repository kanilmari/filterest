"""test_translation_scope_storage.py
Keep the frozen migration report aligned with runtime ownership and key naming.
Connect the reviewed storage catalogue and every generated suffix to SQL.
Exercise real unresolved-label warnings with disposable PostgreSQL when enabled.
"""
from pathlib import Path
import re

from test_row_actor_support import cluster  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / "server_tools/migrations/20261015000006_backfill_translation_object_sources.sql"


def test_translation_report_covers_every_generated_suffix_and_storage_table():
    migration = MIGRATION.read_text()
    naming = (APP / "backend/core_components/lang_key_naming/lang_key_naming.go").read_text()
    reader = (APP / "backend/core_components/lang/translation_scope_reader.go").read_text()
    suffixes = re.findall(r'"([^"]+)"', naming.split("var dynamicSuffixes = []string{", 1)[1].split("}", 1)[0])
    suffix_pattern = re.search(r"keys.lang_key ~ '([^']*\$)'", migration).group(1)
    for suffix in suffixes:
        assert re.search(suffix_pattern, "confidential_mergers" + suffix), suffix
    storage = reader.split("func translationStorageTable(", 1)[1].split("return true", 1)[0]
    runtime_tables = set(re.findall(r'"(system_[^"]+)"', storage))
    report = migration.split("FOR unresolved IN", 1)[1]
    report_tables = set(re.findall(r"'(system_[^']+)'", report))
    assert runtime_tables == report_tables
    assert "system_lang_key_translations" in runtime_tables
    assert "source.source_type = 'foreign_key'" in report
    assert "split_part(source.source_high, '.', 1) = 'public'" in report


def test_translation_report_lists_legacy_sort_labels_with_storage_only_postgres(cluster):
    database = "sec2_storage_report"
    cluster("CREATE DATABASE " + database)
    cluster((APP / "server_tools/public_bootstrap/schema.sql").read_text(), database)
    cluster((APP / "server_tools/public_bootstrap/seed_data.sql").read_text(), database)
    cluster("""
        INSERT INTO system_lang_keys(lang_key,en,fi) VALUES
            ('confidential_mergers_asc','Private ascending','Yksityinen nouseva'),
            ('confidential_mergers_desc','Private descending','Yksityinen laskeva');
        INSERT INTO system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen)
        SELECT id,'foreign_key','public.system_lang_key_translations.lang_key_id','lang_key_id',CURRENT_DATE
        FROM system_lang_keys WHERE lang_key='confidential_mergers_desc';
    """, database)
    result = cluster(MIGRATION.read_text(), database)
    for suffix in ("asc", "desc"):
        assert "unresolved object key (withheld from non-admin translations): confidential_mergers_" + suffix in result.stderr
