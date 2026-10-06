-- 20261005000075_seed_runtime_grant_refusal_language_keys.sql
-- Seeds Finnish and English runtime-grant refusals.
-- Connects transactional permission refusals to translated interface copy.
-- Exists to explain refused saves without overwriting reviewed site wording.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('error_runtime_grant_policy_blocked', 'Oikeuksia ei voitu tallentaa, koska aineiston tai sen riippuvuuksien oikeussäännöt on tarkistettava.', 'Permissions could not be saved because a dataset or its dependencies need a permission-policy review.'),
        ('error_runtime_grant_privilege_managed', 'Muuta tämän sovelluksen tietokantatilin oikeuksia ryhmien ja aineistojen oikeusasetuksista.', 'Change this runtime role''s permissions through group and dataset rights.'),
        ('error_trigger_source_dataset_missing', 'Automaation lähdeaineistoa ei ole olemassa.', 'The automation source dataset does not exist.'),
        ('error_trigger_target_dataset_missing', 'Automaation kohdeaineistoa ei ole olemassa.', 'The automation target dataset does not exist.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL124 runtime grant refusal copy.' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
-- Normalized translations require nonblank text. Missing copy is represented
-- by an absent row, never an empty value; preserve every existing served row.
INSERT INTO public.system_lang_key_translations
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO NOTHING;
