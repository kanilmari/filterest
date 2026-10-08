-- 20261007000002_seed_multiselect_language_keys.sql
-- Seeds shared multiselect summaries, search recovery and clear-action copy.
-- Connects the column filter's reusable dropdown to Finnish and English translations.
-- Inserts missing copy only so upgrades and fresh bootstraps preserve reviewed wording.
-- VERSION_DB: 9.10.1
-- VERSION_DB_OWNER: 20261007000099_record_database_release_9_10_1.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('selected', 'valittu', 'selected'),
        ('excluded', 'poissuljettu', 'excluded'),
        ('no_results', 'Ei tuloksia', 'No results'),
        ('clear_selection', 'Tyhjennä valinta', 'Clear selection')
), inserted_keys AS (
    INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
    SELECT authored.lang_key, authored.fi, authored.en, 'WL103 slice 3b shared multiselect copy.'
    FROM authored_keys AS authored
    WHERE NOT EXISTS (SELECT 1 FROM public.system_lang_keys AS existing WHERE existing.lang_key = authored.lang_key)
    RETURNING id, lang_key, fi, en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM inserted_keys
    UNION ALL
    SELECT existing.id, existing.lang_key, existing.fi, existing.en FROM public.system_lang_keys AS existing
    JOIN authored_keys USING (lang_key)
), inserted_translations AS (
    INSERT INTO public.system_lang_key_translations (lang_key_id, language_code, translation, source_kind, review_status)
    SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
    FROM served_keys AS served
    CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
    JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
    WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.system_lang_key_translations AS existing
          WHERE existing.lang_key_id = served.id AND existing.language_code = copy.language_code)
    RETURNING lang_key_id
)
SELECT count(*) FROM inserted_translations;
