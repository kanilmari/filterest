-- 20261015000016_seed_first_run_setup_code.sql
-- Seeds Finnish and English setup-code copy and makes name suggestions read-only.
-- Connects the public first-run form to both language stores and its source context.
-- Preserves installation wording; the suggestion body uses only reads, lower and unnest.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql
-- COMPLETION_MARKER: wo41_first_run_readonly

-- The original body only checks public/restricted names and the caller's exclusions.
-- lower(text) and unnest(anyarray) are immutable; no write or volatile call occurs.
ALTER FUNCTION public.app_next_admin_display_name(text, text[]) STABLE;

INSERT INTO public.system_data_repair_records (migration, action)
SELECT 'wo41_first_run_readonly', 'completed'
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'wo41_first_run_readonly' AND action = 'completed');

-- BOOTSTRAP_LANGUAGE_SEED
-- Schema runs before synthetic users; copy runs after supported languages exist.
WITH authored_keys(lang_key, fi, en) AS (VALUES
    ('first_run_setup_code', 'Käyttöönottokoodi', 'Setup code'),
    ('first_run_setup_code_help', 'Syötä palvelimen lokissa tai asennuksen tai palautuksen tulosteessa näkyvä käyttöönottokoodi.', 'Enter the setup code from the server log or the installation or recovery output.')
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
    SELECT lang_key, fi, en, 'WO41 A2 first-run setup-code form.' FROM resolved
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
SELECT id, 'code', 'frontend/templates/first_run_admin.html', '',
    'Setup-code label and operator instructions on the first-run form.', CURRENT_DATE
FROM public.system_lang_keys WHERE lang_key IN ('first_run_setup_code', 'first_run_setup_code_help')
ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING;
