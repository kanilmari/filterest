"""test_cancel_changes_language_seed.py
Check reviewed discard wording, bootstrap inclusion and exact file context.
Connect offline packaging checks to optional disposable PostgreSQL replay proofs.
Preserve site-authored copy and keep Chinese generation outside offline tests.
"""
import hashlib
import json
from pathlib import Path
import re

import pytest

from test_field_settings_language_seed import database  # noqa: F401

APP = Path(__file__).resolve().parents[2]
BOOTSTRAP = APP / "server_tools/public_bootstrap"
MIGRATION = APP / "server_tools/migrations/20261015000015_seed_cancel_changes_language_key.sql"
FI, EN = "Peruuta muutokset", "Cancel changes"


def sources():
    return re.findall(r"\('(frontend/[^']+)', '([^']+)'\)", MIGRATION.read_text())


def test_reviewed_key_and_release_owner_match_fresh_packaging():
    sql = MIGRATION.read_text()
    assert f"('cancel_changes', '{FI}', '{EN}')" in sql
    assert "-- VERSION_DB: 9.12.0" in sql
    owner = "20261015000099_record_database_release_9_12_0.sql"
    assert f"-- VERSION_DB_OWNER: {owner}" in sql and MIGRATION.name < owner
    assert "system_db_version" not in sql
    assert "creation_spec" in sql and "WL169 J8 (#873, K403)" in sql
    assert sql in (BOOTSTRAP / "seed_data.sql").read_text()
    assert MIGRATION.name in (BOOTSTRAP / "generate_bootstrap.py").read_text()
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    assert MIGRATION.name in manifest["migration_ledger_baseline"]
    evidence = manifest["source_files"][f"filterest/app/server_tools/migrations/{MIGRATION.name}"]
    assert evidence["sha256"] == hashlib.sha256(MIGRATION.read_bytes()).hexdigest()


def test_both_stores_fill_only_blank_values_and_do_not_invent_chinese_copy():
    sql = MIGRATION.read_text()
    assert "INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)" in sql
    assert "INSERT INTO public.system_lang_key_translations AS existing" in sql
    for column in ("fi", "en"):
        assert f"NULLIF(btrim(keys.{column}), '')" in sql
        assert f"NULLIF(btrim({column}.translation), '')" in sql
        assert f"THEN EXCLUDED.{column} ELSE existing.{column} END" in sql
    assert "WHERE NULLIF(btrim(existing.translation), '') IS NULL" in sql
    assert "ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING" in sql
    assert not re.search(r"\b(ch|yue|zh-CN|zh-TW|zh-HK)\b", sql)


def test_exact_changed_file_sources_have_discard_context_and_real_consumers():
    rows = sources()
    assert len(rows) == 17 and len({path for path, _ in rows}) == 17
    assert any(path.endswith("/field_view_editor.js") for path, _ in rows)
    for path, context in rows:
        assert "cancel_changes" in (APP / path).read_text()
        assert len(context) > 40
        assert path.endswith(".js") and "/tests/" not in path
        assert not any(name in path for name in (
            "confirm_modal_builder", "view_field_assignments_layout", "view_field_assignments_view",
            "article_section_defaults_panel", "column_view_preset_builder",
        ))


def snapshot(database):
    return database("""SELECT jsonb_build_array(
        (SELECT jsonb_agg(k ORDER BY lang_key) FROM system_lang_keys k),
        (SELECT jsonb_agg(t ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t),
        (SELECT jsonb_agg(s ORDER BY lang_key_id,source_type,source_high) FROM system_lang_key_sources s))""")


@pytest.mark.parametrize("store", ["new", "blank", "columns", "normalized", "both", "different"])
def test_upgrade_preserves_authored_copy_in_each_store_and_is_repeat_safe(database, store):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); INSERT INTO system_languages VALUES('fi'),('en');")
    if store != "new":
        fi, en = ("Oma teksti", "Site text") if store in {"columns", "both", "different"} else (" ", "")
        database(f"INSERT INTO system_lang_keys(lang_key,fi,en,creation_spec) VALUES('cancel_changes','{fi}','{en}','Site origin')")
        if store in {"normalized", "both", "different", "blank"}:
            fi, en = (" ", "") if store == "blank" else ("Oma käännös", "Site translation")
            database(f"""INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
                SELECT id,copy.code,copy.text,'manual','approved' FROM system_lang_keys
                CROSS JOIN (VALUES('fi','{fi}'),('en','{en}')) copy(code,text)""")
    database(MIGRATION.read_text())
    expected = (FI, EN) if store in {"new", "blank"} else \
        ("Oma käännös", "Site translation") if store == "normalized" else ("Oma teksti", "Site text")
    assert database("SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='cancel_changes'") == "|".join(expected)
    normalized = ("Oma käännös", "Site translation") if store in {"normalized", "both", "different"} else expected
    assert database("SELECT string_agg(translation,'|' ORDER BY language_code DESC) FROM system_lang_key_translations") == "|".join(normalized)
    assert database("SELECT count(*) FROM system_lang_key_sources WHERE source_type='code' AND source_low='' AND NULLIF(btrim(usage_explanation),'') IS NOT NULL") == "17"
    if store != "new":
        assert database("SELECT creation_spec FROM system_lang_keys WHERE lang_key='cancel_changes'") == "Site origin"
    before = snapshot(database)
    database(MIGRATION.read_text())
    assert snapshot(database) == before
    assert database("SELECT count(*) FROM system_db_version") == "0"
