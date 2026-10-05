-- 20261005000005_seed_row_actor_language_keys.sql
-- Seeds Finnish and English creator/owner labels and the seven group A refusals.
-- Bridges the protected columns and commit 3's request errors with translated UI copy.
-- Exists so the browser can explain those refusals and replace machine-generated
-- labels without overwriting a site's wording. K175 limits new copy to fi/en; K211
-- moved this seed from 000002. Empty values alone are filled, except the exact
-- generated search/sort values listed below. The same file serves fresh packages.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en, generated_fi, generated_en, creation_spec) AS (
    VALUES
        ('created_by', 'Luonut', 'Created by', NULL, NULL, 'WL58 creator/owner column interface copy.'),
        ('owner_id', 'Omistaja', 'Owner', NULL, NULL, 'WL58 creator/owner column interface copy.'),
        ('search_for_created_by', 'Etsi luojan mukaan', 'Search by creator', 'Etsi: Created by', 'Search: Created by', 'WL58 creator/owner column interface copy.'),
        ('created_by_asc', 'Luonut, nouseva', 'Created by, ascending', 'Created by, nouseva', 'Created by, ascending', 'WL58 creator/owner column interface copy.'),
        ('created_by_desc', 'Luonut, laskeva', 'Created by, descending', 'Created by, laskeva', 'Created by, descending', 'WL58 creator/owner column interface copy.'),
        ('search_for_owner_id', 'Etsi omistajan mukaan', 'Search by owner', 'Etsi: Owner ID', 'Search: Owner ID', 'WL58 creator/owner column interface copy.'),
        ('owner_id_asc', 'Omistaja, nouseva', 'Owner, ascending', 'Owner ID, nouseva', 'Owner ID, ascending', 'WL58 creator/owner column interface copy.'),
        ('owner_id_desc', 'Omistaja, laskeva', 'Owner, descending', 'Owner ID, laskeva', 'Owner ID, descending', 'WL58 creator/owner column interface copy.'),
        ('error_creator_column_not_editable', 'Rivin luojaa ei voi muuttaa.', 'The row''s creator cannot be changed.', NULL, NULL, '400 refusal reason shown by the request pipeline.'),
        ('error_owner_column_not_editable', 'Rivin omistajaa ei voi muuttaa muokkaamalla. Omistajan siirto tehdään ylläpitotoimintona.', 'The row''s owner cannot be changed by editing. Ownership is transferred as a maintenance action.', NULL, NULL, '400 refusal reason shown by the request pipeline.'),
        ('error_owner_column_protected', 'Luoja- ja omistajasaraketta ei voi poistaa, nimetä uudelleen eikä muuttaa, eikä niiden käyttäjäviittausta voi poistaa tai lisätä toista.', 'The creator and owner columns cannot be deleted, renamed or changed, and their user reference cannot be removed or duplicated.', NULL, NULL, '400 refusal reason shown by the request pipeline.'),
        ('error_reserved_owner_column', 'Sarakenimet created_by ja owner_id on varattu luojalle ja omistajalle. Jätä ne pois tai anna niille kokonaislukutyyppi ilman oletusarvoa; ne voivat viitata vain käyttäjiin.', 'The column names created_by and owner_id are reserved for the creator and owner. Leave them out, or give them an integer type without a default value; they can only reference users.', NULL, NULL, '400 refusal reason shown by the request pipeline.'),
        ('error_trigger_actor_column', 'Automaatio ei voi asettaa riville luojaa eikä omistajaa; ne tulevat aina pyynnön tekijästä.', 'An automation cannot set a row''s creator or owner; they always come from the person making the request.', NULL, NULL, '400 refusal reason shown by the request pipeline.'),
        ('error_row_owner_setting_fixed', 'Tämän aineiston omistajasarake on kiinnitetty, eikä sitä voi vaihtaa asetuksista.', 'This dataset''s owner column is fixed and cannot be changed in the settings.', NULL, NULL, '400 refusal reason shown by the request pipeline.'),
        ('error_internal_table_not_droppable', 'Tämä on sovelluksen sisäinen taulu, eikä sitä voi poistaa.', 'This is an internal application table and cannot be deleted.', NULL, NULL, '400 refusal reason shown by the request pipeline.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, creation_spec FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL OR existing.fi =
                       (SELECT generated_fi FROM authored_keys WHERE lang_key = EXCLUDED.lang_key)
                  THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL OR existing.en =
                       (SELECT generated_en FROM authored_keys WHERE lang_key = EXCLUDED.lang_key)
                  THEN EXCLUDED.en ELSE existing.en END,
        creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                             THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
        updated = now()
    WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.creation_spec), '') IS NULL
       OR (existing.fi = (SELECT generated_fi FROM authored_keys WHERE lang_key = EXCLUDED.lang_key) AND existing.fi IS DISTINCT FROM EXCLUDED.fi)
       OR (existing.en = (SELECT generated_en FROM authored_keys WHERE lang_key = EXCLUDED.lang_key) AND existing.en IS DISTINCT FROM EXCLUDED.en)
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    -- A statement sees the written rows through RETURNING, not a table re-read.
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL
    OR (existing.translation IS DISTINCT FROM EXCLUDED.translation AND existing.translation = (
        SELECT CASE existing.language_code WHEN 'fi' THEN authored.generated_fi ELSE authored.generated_en END
          FROM authored_keys AS authored JOIN served_keys AS served USING (lang_key)
         WHERE served.id = existing.lang_key_id));
