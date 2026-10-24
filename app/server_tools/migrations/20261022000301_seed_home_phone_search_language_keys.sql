-- 20261022000301_seed_home_phone_search_language_keys.sql
-- Seeds reviewed Finnish and English phone Home search copy in both stores.
-- Connects the accessible sheet and its request status with editable translations.
-- Preserves site-authored copy and leaves other languages for the coordinator.
-- VERSION_DB: 9.13.0
-- VERSION_DB_OWNER: 20261022000399_record_database_release_9_13_0.sql

WITH authored_keys(lang_key, fi, en) AS (VALUES
    ('front_page_search_site', 'Hae sivustolta', 'Search the site'),
    ('front_page_search_title', 'Haku', 'Search'),
    ('front_page_search_close', 'Sulje haku', 'Close search'),
    ('front_page_search_searching', 'Haetaan…', 'Searching…'),
    ('front_page_search_no_results', 'Ei osumia', 'No results'),
    ('front_page_search_failed', 'Hakua ei voitu suorittaa. Yritä uudelleen.', 'Search could not be completed. Try again.')
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
    SELECT lang_key, fi, en, 'WO88 K477: phone Home search dialog and bounded ordinary text search.' FROM resolved
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
    ('front_page_search_site', 'frontend/core_components/front_page/front_page_search_sheet.js', 'Accessible name of the phone Home magnifier that opens site search.'),
    ('front_page_search_title', 'frontend/core_components/front_page/front_page_search_sheet.js', 'Accessible dialog and input name for phone Home search.'),
    ('front_page_search_close', 'frontend/core_components/front_page/front_page_search_sheet.js', 'Close phone Home search and return focus to its magnifier.'),
    ('front_page_search_searching', 'frontend/core_components/front_page/front_page_search_runner.js', 'Live status while readable dataset text searches are pending.'),
    ('front_page_search_no_results', 'frontend/core_components/front_page/front_page_search_runner.js', 'Single empty-state line after every readable dataset has no matches.'),
    ('front_page_search_failed', 'frontend/core_components/front_page/front_page_search_runner.js', 'Search could not complete; do not mistake a transport error for no matches.')
) AS source(lang_key, path, explanation) ON source.lang_key = keys.lang_key
ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING;
