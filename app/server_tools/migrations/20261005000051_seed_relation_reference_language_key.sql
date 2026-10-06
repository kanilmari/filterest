-- 20261005000051_seed_relation_reference_language_key.sql
-- Seeds the missing stored-reference refusal in Finnish and English.
-- Connects transactional relation readers with the request pipeline's reason key.
-- Exists so a refused save is explained in the reader's language. As with WL58,
-- existing authored translations stay; empty values alone receive the new copy.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    VALUES ('error_relation_reference_missing',
            'Viitatulta riviltä puuttuu liitoksen tarvitsema arvo. Mitään rivejä ei tallennettu.',
            'A referenced row is missing the value needed for this link. No rows were saved.',
            'WL144 missing stored-reference refusal.')
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN nullif(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN nullif(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END
     WHERE nullif(btrim(existing.fi), '') IS NULL OR nullif(btrim(existing.en), '') IS NULL
    RETURNING id, lang_key, fi, en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT id, lang_key, fi, en FROM public.system_lang_keys
     WHERE lang_key = 'error_relation_reference_missing'
       AND NOT EXISTS (SELECT 1 FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE nullif(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE nullif(btrim(existing.translation), '') IS NULL;
