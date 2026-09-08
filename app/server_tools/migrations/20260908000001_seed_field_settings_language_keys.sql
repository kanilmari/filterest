-- 20260908000001_seed_field_settings_language_keys.sql
-- Supplies reviewed field-selection translations to existing installations.
-- Bridges the public bootstrap language source and the incremental migration runner.
-- Prevents first-visit translation repair prompts while preserving site-authored copy.
-- VERSION_DB: 9.7.4

-- Seeds field-collection ownership and inheritance copy before the first view opens.
-- Connects the field selector to reviewed Finnish/English and existing legacy fallbacks.
-- Preserves nonempty site-authored translations and records each key's actual UI source.
-- Shared by fresh public bootstrap and the matching additive upgrade migration.

WITH authored_keys(lang_key, fi, en, ch, yue, creation_spec) AS (
    VALUES
        ('field_set_owner_personal', 'Henkilökohtainen', 'Personal', '个人', '個人', 'Labels a field collection owned only by the current user.'),
        ('field_set_source_personal', 'Henkilökohtainen ohitus on käytössä', 'Personal override in use', '正在使用个人覆盖设置', '正在使用個人覆寫設定', 'Explains that the user''s personal field selection overrides inherited defaults.'),
        ('field_set_source_group', 'Ryhmäkohtainen oletus on käytössä', 'Group default in use', '正在使用组默认设置', '正在使用群組預設設定', 'Explains that the effective field selection comes from a user-group default.'),
        ('field_set_source_site', 'Sivuston oletus on käytössä', 'Site default in use', '正在使用站点默认设置', '正在使用網站預設設定', 'Explains that the effective field selection comes from the site default.'),
        ('field_set_source_metadata', 'Metadatan oletus on käytössä', 'Metadata default in use', '正在使用元数据默认设置', '正在使用中繼資料預設設定', 'Explains that the effective field selection comes from column metadata.'),
        ('field_set_editing_site_default', 'Muokataan sivuston oletusta (vain jaetut kenttäjoukot)', 'Editing site default (shared collections only)', '正在编辑站点默认设置（仅限共享集合）', '正在編輯網站預設設定（只限共用集合）', 'Explains why only shared field collections are editable as the site default.'),
        ('field_set_assignment_unavailable', 'Tallennettu kenttäjoukkovalinta ei ole käytettävissä. Palvelimen turvallinen kenttävalinta on edelleen käytössä.', 'The saved field collection is unavailable. The server''s safe field selection remains in use.', '已保存的字段集合不可用。服务器的安全字段选择仍在使用。', '已儲存嘅欄位集合用唔到。伺服器嘅安全欄位選擇仍然使用中。', 'Explains that the server keeps a safe field selection when a saved collection is unavailable.'),
        ('use_site_default', 'Käytä sivuston oletusta', 'Use site default', '使用站点默认设置', '使用網站預設設定', 'Restores inherited site defaults after removing a personal field selection.'),
        ('use_metadata_default', 'Käytä metadatan oletusta', 'Use metadata default', '使用元数据默认设置', '使用中繼資料預設設定', 'Restores column-metadata defaults when no site field selection exists.'),
        ('field_set_inheritance_restored', 'Oma ohitus poistettiin', 'Personal override removed', '已移除个人覆盖设置', '已移除個人覆寫設定', 'Confirms that a personal field-selection override was removed.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
SELECT lang_key, fi, en, ch, yue, creation_spec FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = CASE WHEN NULLIF(btrim(system_lang_keys.fi), '') IS NULL THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
    en = CASE WHEN NULLIF(btrim(system_lang_keys.en), '') IS NULL THEN EXCLUDED.en ELSE system_lang_keys.en END,
    ch = CASE WHEN NULLIF(btrim(system_lang_keys.ch), '') IS NULL THEN EXCLUDED.ch ELSE system_lang_keys.ch END,
    yue = CASE WHEN NULLIF(btrim(system_lang_keys.yue), '') IS NULL THEN EXCLUDED.yue ELSE system_lang_keys.yue END,
    creation_spec = CASE WHEN NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL THEN EXCLUDED.creation_spec ELSE system_lang_keys.creation_spec END,
    updated = now()
WHERE NULLIF(btrim(system_lang_keys.fi), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.en), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.ch), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.yue), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL;

-- Only reviewed locales are published into the normalized translation catalog.
-- Existing Chinese/Cantonese fallbacks remain in their legacy fields; this change
-- does not claim a new locale review or map Cantonese to an unreviewed region.
WITH selected_keys AS (
    SELECT id, fi, en
    FROM public.system_lang_keys
    WHERE lang_key IN (
        'field_set_owner_personal',
        'field_set_source_personal',
        'field_set_source_group',
        'field_set_source_site',
        'field_set_source_metadata',
        'field_set_editing_site_default',
        'field_set_assignment_unavailable',
        'use_site_default',
        'use_metadata_default',
        'field_set_inheritance_restored'
    )
), authored_translations AS (
    SELECT keys.id AS lang_key_id, copy.language_code, copy.translation
    FROM selected_keys AS keys
    CROSS JOIN LATERAL (VALUES ('fi', keys.fi), ('en', keys.en))
        AS copy(language_code, translation)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT lang_key_id, language_code, translation, 'manual', 'approved'
FROM authored_translations
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status,
    updated = now()
WHERE NULLIF(btrim(system_lang_key_translations.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT keys.id,
       'code',
       'frontend/core_components/filterbar/filter_list/column_view_preset_builder.js',
       '',
       keys.creation_spec,
       CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE keys.lang_key IN (
    'field_set_owner_personal',
    'field_set_source_personal',
    'field_set_source_group',
    'field_set_source_site',
    'field_set_source_metadata',
    'field_set_editing_site_default',
    'field_set_assignment_unavailable',
    'use_site_default',
    'use_metadata_default',
    'field_set_inheritance_restored'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET last_seen = CURRENT_DATE;

INSERT INTO public.system_db_version (version, description)
SELECT '9.7.4', 'Seed reviewed field-selection ownership and inheritance translations'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_version WHERE version = '9.7.4'
);
