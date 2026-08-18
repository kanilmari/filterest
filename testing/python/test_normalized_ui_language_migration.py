"""Guard the additive normalized UI-language schema migration.

Bridges the legacy wide language-key table with canonical BCP 47 locale rows.
Exists so no locale is published or relabeled without explicit review evidence.
"""

from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    PROJECT_ROOT
    / "server_tools/migrations/20260817000002_normalize_ui_languages.sql"
)
SITE_SETTINGS_DOC = (
    PROJECT_ROOT
    / "docs/instructions_and_documentation/Filterest_Use_Cases_And_Site_Settings.md"
)
PUBLIC_RUNTIME_SCHEMA = (
    PROJECT_ROOT
    / "server_tools/public_slice_export/public_bootstrap/runtime.schema.sql"
)
PUBLIC_APP_SEED = (
    PROJECT_ROOT
    / "server_tools/public_slice_export/public_bootstrap/app_tables.seed.sql"
)
PUBLIC_LANGUAGE_SEED = (
    PROJECT_ROOT
    / "server_tools/public_slice_export/public_bootstrap/app_tables.lang_keys.sql"
)
SITE_LANGUAGE_SETTINGS_MIGRATION = (
    PROJECT_ROOT
    / "server_tools/migrations/20260817000008_seed_site_language_settings_permissions.sql"
)


def migration_sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_migration_adds_registered_normalized_tables_without_removing_legacy_source() -> None:
    sql = migration_sql()

    assert "CREATE TABLE IF NOT EXISTS public.system_languages" in sql
    assert "CREATE TABLE IF NOT EXISTS public.system_lang_key_translations" in sql
    assert "REFERENCES public.system_lang_keys(id) ON DELETE CASCADE" in sql
    assert "UNIQUE (lang_key_id, language_code)" in sql
    assert "'system_languages', 'Languages'" in sql
    assert "'system_lang_key_translations', 'Language Key Translations'" in sql
    assert "INSERT INTO public.system_column_details" in sql
    assert "DROP TABLE" not in sql.upper()
    assert "ALTER TABLE public.system_lang_keys" not in sql


def test_registry_seeds_only_the_five_canonical_first_slice_codes() -> None:
    sql = migration_sql()
    seed_block = sql.split("WITH desired_languages", 1)[1].split(
        "INSERT INTO public.system_languages", 1
    )[0]
    seeded_codes = re.findall(r"^\s*\('([^']+)'", seed_block, flags=re.MULTILINE)

    assert seeded_codes == ["en", "fi", "zh-CN", "zh-TW", "zh-HK"]
    assert "CHECK (language_code ~ '^[a-z]{2,3}(-[A-Z]{2})?$')" in sql
    assert "('zh-CN', 'Chinese (Simplified, Mainland China)'" in sql
    assert "('zh-TW', 'Chinese (Traditional, Taiwan)'" in sql
    assert "('zh-HK', 'Chinese (Traditional, Hong Kong)'" in sql
    assert "language_code = split_part(language_code, '-', 1) || '-' || region_code" in sql


def test_registry_initial_state_keeps_unreviewed_chinese_locales_private() -> None:
    sql = migration_sql()

    assert re.search(
        r"\('en',\s+'English'.*?NULL, TRUE,\s+TRUE,\s+NULL, "
        r"'complete',\s+'approved',\s+TRUE,\s+10\)",
        sql,
    )
    assert re.search(
        r"\('fi',\s+'Finnish'.*?NULL, TRUE,\s+FALSE, 'en', "
        r"'complete',\s+'approved',\s+TRUE,\s+20\)",
        sql,
    )
    assert re.search(
        r"\('zh-CN'.*?'CN', FALSE, FALSE, 'en', "
        r"'partial',\s+'needs_review', FALSE,\s+30\)",
        sql,
    )
    assert re.search(
        r"\('zh-TW'.*?'TW', FALSE, FALSE, 'en', "
        r"'not_started', 'unreviewed',\s+FALSE,\s+40\)",
        sql,
    )
    assert re.search(
        r"\('zh-HK'.*?'HK', FALSE, FALSE, 'en', "
        r"'not_started', 'unreviewed',\s+FALSE,\s+50\)",
        sql,
    )


def test_registry_enforces_default_fallback_and_public_selector_gates() -> None:
    sql = migration_sql()

    assert "CREATE UNIQUE INDEX IF NOT EXISTS idx_system_languages_one_default" in sql
    assert "WHERE is_default IS TRUE" in sql
    assert "is_default IS FALSE OR is_enabled IS TRUE" in sql
    assert "is_default IS TRUE AND fallback_language_code IS NULL" in sql
    assert "fallback_language_code <> language_code" in sql
    assert "public_selector_ready IS FALSE" in sql
    assert "coverage_status = 'complete'" in sql
    assert "review_status = 'approved'" in sql


def test_copy_maps_only_non_empty_en_fi_and_legacy_ch_to_zh_cn() -> None:
    sql = migration_sql()
    copy_block = sql.split("WITH legacy_translations AS", 1)[1].split(
        "WITH desired_tables", 1
    )[0]

    assert re.search(r"'en'::TEXT AS language_code,\s+source\.en", copy_block)
    assert re.search(r"'fi'::TEXT,\s+source\.fi", copy_block)
    assert re.search(r"'zh-CN'::TEXT,\s+source\.ch", copy_block)
    assert "NULLIF(btrim(source.translation), '') IS NOT NULL" in copy_block
    assert "source.yue" not in copy_block
    assert "'zh-TW'::TEXT" not in copy_block
    assert "'zh-HK'::TEXT" not in copy_block
    assert "legacy_yue" not in copy_block


def test_migration_is_idempotent_and_stays_in_the_current_release_batch() -> None:
    sql = migration_sql()

    assert "-- VERSION_DB: 9.0.0" in sql
    assert (
        "-- VERSION_DB_OWNER: "
        "20260817000007_repair_filterest_admin_schema_permissions.sql"
    ) in sql
    assert sql.count("NOT EXISTS (") >= 6
    assert "INSERT INTO public.system_db_version" not in sql


def test_site_settings_document_defines_the_language_admin_contract() -> None:
    text = SITE_SETTINGS_DOC.read_text(encoding="utf-8")

    assert "### Admin Language Settings Contract" in text
    assert "Admin → Site settings →\nLanguages" in text
    for code in ("`en`", "`fi`", "`zh-CN`", "`zh-TW`", "`zh-HK`"):
        assert code in text
    assert "Exactly one enabled language is the default" in text
    assert "No fallback (root)" in text
    assert "fallback cycles are rejected" in text
    assert "absent from the public language selector" in text
    assert "coverage is complete" in text
    assert "review state is approved" in text
    assert "automatic `yue` → `zh-HK` mapping" in text


def test_fresh_public_bootstrap_matches_the_normalized_language_contract() -> None:
    schema = PUBLIC_RUNTIME_SCHEMA.read_text(encoding="utf-8")
    app_seed = PUBLIC_APP_SEED.read_text(encoding="utf-8")
    language_seed = PUBLIC_LANGUAGE_SEED.read_text(encoding="utf-8")

    for table_name in ("system_languages", "system_lang_key_translations"):
        assert f"CREATE TABLE IF NOT EXISTS public.{table_name}" in schema
        assert f"'{table_name}'" in app_seed

    assert "idx_system_languages_one_default" in schema
    assert "idx_system_lang_key_translations_language" in schema
    assert "UNIQUE (lang_key_id, language_code)" in schema
    assert "IN ('legacy_en', 'legacy_fi', 'legacy_ch', 'manual', 'import')" in schema
    assert "IN ('unreviewed', 'needs_review', 'approved')" in schema
    assert "'system_languages'," in app_seed
    assert "'system_lang_key_translations'," in app_seed

    registry_block = language_seed.split(
        "INSERT INTO public.system_languages", 1
    )[1].split("WITH legacy_translations AS", 1)[0]
    assert [
        code
        for code in ("en", "fi", "zh-CN", "zh-TW", "zh-HK")
        if f"('{code}'" in registry_block
    ] == ["en", "fi", "zh-CN", "zh-TW", "zh-HK"]
    assert "'zh-CN'::TEXT, source.ch" in language_seed
    normalized_copy = language_seed.split("WITH legacy_translations AS", 1)[1]
    assert "source.yue" not in normalized_copy
    assert "'zh-TW'::TEXT" not in normalized_copy
    assert "'zh-HK'::TEXT" not in normalized_copy


def test_public_language_field_labels_precede_the_derived_search_seed() -> None:
    language_seed = PUBLIC_LANGUAGE_SEED.read_text(encoding="utf-8")

    field_labels_at = language_seed.index("('language_code', 'Kielikoodi'")
    derived_search_at = language_seed.index(
        "INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)\n"
        "SELECT 'search_for_' || base.lang_key"
    )

    assert field_labels_at < derived_search_at


def test_site_language_settings_have_routes_permissions_and_seeded_copy() -> None:
    migration = SITE_LANGUAGE_SETTINGS_MIGRATION.read_text(encoding="utf-8")
    public_seed = PUBLIC_LANGUAGE_SEED.read_text(encoding="utf-8")

    assert "-- VERSION_DB: 9.0.0" in migration
    assert (
        "-- VERSION_DB_OWNER: "
        "20260817000007_repair_filterest_admin_schema_permissions.sql"
    ) in migration
    assert "lang.GetPublicUILanguagesHandler" in migration
    assert "'/api/ui-languages'" in migration
    assert "lang.AdminUILanguagesHandler" in migration
    assert "'/api/admin/ui-languages'" in migration
    assert "groups.name = 'admins'" in migration
    assert "INSERT INTO public.system_db_version" not in migration

    for lang_key in (
        "site_settings",
        "site_languages",
        "site_languages_description",
        "default_language",
        "fallback_language",
        "translation_coverage",
        "public_selector",
        "settings_saved",
    ):
        assert f"('{lang_key}'" in migration
        assert f"('{lang_key}'" in public_seed

    assert "'zh-CN'::TEXT, keys.ch" in migration
    assert "'zh-TW'::TEXT" not in migration
    assert "'zh-HK'::TEXT" not in migration
