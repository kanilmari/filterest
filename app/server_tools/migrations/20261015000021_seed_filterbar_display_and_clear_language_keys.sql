-- 20261015000021_seed_filterbar_display_and_clear_language_keys.sql
-- Renames the display disclosure and seeds the singular selected-filter action.
-- Connects the existing filter bar consumers to upgrade and fresh-install copy.
-- Preserves site-authored values and leaves other languages for reviewed translation.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql
-- COMPLETION_MARKER: wo46_filterbar_display_and_clear

-- Replace only the exact shipped defaults, independently in each store/language.
-- Whitespace, blank values and administrator edits are deliberately left alone.
WITH copy(fi, en, old_fi, old_en) AS (VALUES
    ('Näyttöasetukset', 'Display settings', 'Tyyli- ja väriasetukset', 'Style and color settings')
), renamed AS (
    UPDATE public.system_lang_keys keys
    SET fi = CASE WHEN keys.fi = copy.old_fi THEN copy.fi ELSE keys.fi END,
        en = CASE WHEN keys.en = copy.old_en THEN copy.en ELSE keys.en END
    FROM copy
    WHERE keys.lang_key = 'filterbar_style_and_colors'
        AND (keys.fi = copy.old_fi OR keys.en = copy.old_en)
    RETURNING keys.id
)
UPDATE public.system_lang_key_translations translated
SET translation = changed.value
FROM public.system_lang_keys keys, copy,
    LATERAL (VALUES ('fi', copy.old_fi, copy.fi), ('en', copy.old_en, copy.en))
        AS changed(language_code, old_value, value)
WHERE translated.lang_key_id = keys.id AND keys.lang_key = 'filterbar_style_and_colors'
    AND translated.language_code = changed.language_code AND translated.translation = changed.old_value;

WITH authored_keys(lang_key, fi, en) AS (VALUES
    ('clear', 'Tyhjennä', 'Clear')
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
    SELECT lang_key, fi, en, 'WO46: remove exactly one selected search or filter chip; multiple chips use clear_all.' FROM resolved
    WHERE NOT EXISTS (SELECT 1 FROM public.system_lang_keys k WHERE k.lang_key = resolved.lang_key
        AND NULLIF(btrim(k.fi), '') IS NOT NULL AND NULLIF(btrim(k.en), '') IS NOT NULL)
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

-- Register the new key's exact frontend context; existing display sources stay intact.
INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT id, 'code', 'frontend/core_components/filterbar/filter_list/active_filter_tag_printer.js',
    '', 'Remove the one selected filter or search chip; multiple selections use clear_all.', CURRENT_DATE
FROM public.system_lang_keys WHERE lang_key = 'clear'
ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING;

INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'wo46_filterbar_display_and_clear', 'completed', '{"file":"20261015000021_seed_filterbar_display_and_clear_language_keys.sql"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'wo46_filterbar_display_and_clear' AND action = 'completed');
