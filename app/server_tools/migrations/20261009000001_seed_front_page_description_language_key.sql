-- 20261009000001_seed_front_page_description_language_key.sql
-- Seeds separate Home description and three-field editor guidance in Finnish and English.
-- Connects upgrades and fresh installations to the canonical translation stores.
-- Preserves reviewed site copy and registers intentional empty description text.
-- VERSION_DB: 9.10.2
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_10_2.sql

WITH authored_keys(lang_key, fi, en, old_fi, old_en) AS (
    VALUES
        ('site_front_page_description', '', '', NULL::text, NULL::text),
        ('slogan', 'Iskulause', 'Slogan', NULL::text, NULL::text),
        ('front_page_hero', 'Etusivun otsikko, iskulause ja kuvaus', 'Home title, slogan and description', 'Etusivun otsikko ja iskulause', 'Home title and slogan'),
        ('front_page_hero_help', 'Tyhjä otsikko käyttää sivuston nimeä. Iskulause ja kuvaus voivat olla tyhjiä, monirivisiä tai käytössä yhdessä. Tyhjä teksti piilotetaan.', 'An empty title uses the site name. Slogan and description may be empty, multi-line or used together. Empty text is hidden.', 'Tyhjä otsikko käyttää sivuston nimeä. Tyhjää iskulausetta ei näytetä.', 'An empty title uses the site name. An empty slogan is hidden.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'Home title, slogan and description copy.' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL OR existing.fi = (SELECT old_fi FROM authored_keys WHERE lang_key=existing.lang_key) THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL OR existing.en = (SELECT old_en FROM authored_keys WHERE lang_key=existing.lang_key) THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR existing.fi = (SELECT old_fi FROM authored_keys WHERE lang_key=existing.lang_key)
        OR existing.en = (SELECT old_en FROM authored_keys WHERE lang_key=existing.lang_key)
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 JOIN authored_keys authored USING (lang_key)
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL
    OR existing.translation = (SELECT CASE existing.language_code WHEN 'fi' THEN old_fi ELSE old_en END
        FROM authored_keys WHERE lang_key = (SELECT lang_key FROM public.system_lang_keys WHERE id=existing.lang_key_id));

-- Intentional empty text must survive language-catalog cleanup.
INSERT INTO public.system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen,usage_explanation)
SELECT id,'front_page_hero',lang_key,'front_page_hero',CURRENT_DATE,
       'Home description: normal-size text after the title and larger slogan. Blank lines separate paragraphs; single line breaks remain. May be empty or used independently of the slogan.'
FROM public.system_lang_keys WHERE lang_key='site_front_page_description'
ON CONFLICT(lang_key_id,source_type,source_high) DO NOTHING;
