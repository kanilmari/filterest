-- 20261029000100_add_home_top_bar_setting.sql
-- Adds the site-wide Home top-bar opt-in and its Finnish/English editor label.
-- Connects upgraded sites and fresh bootstrap to the same false default.
-- Replay preserves administrator choices and reviewed copy in both stores.
-- VERSION_DB: 9.13.3
-- VERSION_DB_OWNER: 20261029000199_record_database_release_9_13_3.sql

INSERT INTO public.system_config (key, boolean_value, json_value, text_value, value_type, creation_spec)
SELECT 'show_home_button_in_top_bar_on_wide_screens', false, '{"value":false}'::jsonb, 'false', 2,
    'Show the Home button in the top bar only above the phone breakpoint; site-wide, opt-in.'
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'show_home_button_in_top_bar_on_wide_screens');

WITH authored_keys(lang_key, fi, en) AS (VALUES
    ('show_home_button_in_top_bar_on_wide_screens', 'Näytä Etusivu-painike yläpalkissa leveillä näytöillä', 'Show the Home button in the top bar on wide screens')
), resolved AS (
    SELECT copy.lang_key,
        COALESCE(CASE WHEN NULLIF(btrim(keys.fi), '') IS NOT NULL THEN keys.fi END,
            CASE WHEN NULLIF(btrim(fi.translation), '') IS NOT NULL THEN fi.translation END, copy.fi) AS fi,
        COALESCE(CASE WHEN NULLIF(btrim(keys.en), '') IS NOT NULL THEN keys.en END,
            CASE WHEN NULLIF(btrim(en.translation), '') IS NOT NULL THEN en.translation END, copy.en) AS en
    FROM authored_keys copy
    LEFT JOIN public.system_lang_keys keys USING (lang_key)
    LEFT JOIN public.system_lang_key_translations fi ON fi.lang_key_id = keys.id AND fi.language_code = 'fi'
    LEFT JOIN public.system_lang_key_translations en ON en.lang_key_id = keys.id AND en.language_code = 'en'
), written AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WO109 K529: site-wide Home top-bar opt-in; never shown on phones.' FROM resolved
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END
    WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
    RETURNING id, lang_key, fi, en
), served AS (
    SELECT * FROM written UNION ALL
    SELECT k.id, k.lang_key, k.fi, k.en FROM public.system_lang_keys k JOIN authored_keys USING (lang_key)
    WHERE k.id NOT IN (SELECT id FROM written)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT s.id, translated.language_code, translated.translation, 'manual', 'approved'
FROM served s
CROSS JOIN LATERAL (VALUES ('fi', s.fi), ('en', s.en)) AS translated(language_code, translation)
JOIN public.system_languages language ON language.language_code = translated.language_code
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind, review_status = EXCLUDED.review_status
WHERE NULLIF(btrim(existing.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT keys.id, 'code', source.path, '', source.explanation, CURRENT_DATE
FROM public.system_lang_keys keys
JOIN (VALUES
    ('show_home_button_in_top_bar_on_wide_screens', 'frontend/core_components/admin_tools/front_page_settings_view.js', 'Site-wide Home settings: opt in to the Home button above the phone breakpoint, disabled while Home is off.')
) AS source(lang_key, path, explanation) ON source.lang_key = keys.lang_key
ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING;
