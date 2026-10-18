-- 20261015000014_seed_redirect_notice_language_keys.sql
-- Seeds missing and deleted dataset redirect notices in Finnish and English.
-- Connects upgraded and fresh installs to the root redirect translation nodes.
-- Preserves authored site copy in both translation stores on repeat runs.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql

WITH authored_keys(lang_key, fi, en) AS (VALUES
    ('dataset_redirect_missing_named', 'Näkymää $table_name ei löytynyt. Siirryttiin oletusnäkymään.', 'View $table_name was not found. Switched to the default view.'),
    ('dataset_redirect_missing', 'Valittua näkymää ei löytynyt. Siirryttiin oletusnäkymään.', 'The selected view was not found. Switched to the default view.'),
    ('dataset_redirect_deleted_named', 'Taulu $table_name on poistettu. Siirryttiin oletusnäkymään.', 'Dataset $table_name has been deleted. Switched to the default view.'),
    ('dataset_redirect_deleted', 'Taulu on poistettu. Siirryttiin oletusnäkymään.', 'The dataset has been deleted. Switched to the default view.')
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
    SELECT lang_key, fi, en, 'Dataset redirect toast after a missing or deleted dataset; $table_name comes from data-lang-variable.' FROM resolved
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

-- Register translation context for startup source scanning and retirement safety.
INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT id, 'code', 'frontend/core_components/navigation/root_redirect_handler.js',
    '', 'Startup notice after a missing or deleted dataset redirects to the default view; the name stays a separate value.', CURRENT_DATE
FROM public.system_lang_keys WHERE lang_key IN ('dataset_redirect_missing_named', 'dataset_redirect_missing', 'dataset_redirect_deleted_named', 'dataset_redirect_deleted')
ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING;
