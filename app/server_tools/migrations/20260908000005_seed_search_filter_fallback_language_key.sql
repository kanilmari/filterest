-- Seeds the notice explaining automatic text-search results without selected filters.
-- Connects the common search presentation to reviewed Finnish and English copy.
-- Preserves every existing nonempty site translation and never changes user data.
-- Shared by the public bootstrap and the corresponding additive upgrade migration.

INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
VALUES (
    'search_results_without_filters',
    'Valituilla suodattimilla ei löytynyt tekstiosumia. Näytetään tulokset ilman suodattimia. Valinnat säilyvät seuraavaa hakua varten.',
    'No text matches with the selected filters. Showing results without filters. Your selections are kept for the next search.',
    'Explains that authorized text results are shown without optional filters while retaining the selected filters for the next query.'
)
ON CONFLICT (lang_key) DO UPDATE
SET fi = CASE WHEN NULLIF(btrim(system_lang_keys.fi), '') IS NULL THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
    en = CASE WHEN NULLIF(btrim(system_lang_keys.en), '') IS NULL THEN EXCLUDED.en ELSE system_lang_keys.en END,
    creation_spec = CASE WHEN NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL THEN EXCLUDED.creation_spec ELSE system_lang_keys.creation_spec END,
    updated = now()
WHERE NULLIF(btrim(system_lang_keys.fi), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.en), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL;

INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT keys.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM public.system_lang_keys AS keys
CROSS JOIN LATERAL (VALUES ('fi', keys.fi), ('en', keys.en)) AS copy(language_code, translation)
WHERE keys.lang_key = 'search_results_without_filters'
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status, updated = now()
WHERE NULLIF(btrim(system_lang_key_translations.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen
)
SELECT id, 'code', 'frontend/core_components/filterbar/text_search/dataset_search_executor.js',
       '', creation_spec, CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key = 'search_results_without_filters'
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE SET last_seen = CURRENT_DATE;

INSERT INTO public.system_db_version (version, description)
SELECT '9.7.8', 'Seed automatic search-filter fallback notice'
WHERE NOT EXISTS (SELECT 1 FROM public.system_db_version WHERE version = '9.7.8');
