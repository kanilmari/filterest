-- 20261005000086_seed_front_page_hero_language_keys.sql
-- Seeds Finnish and English Home hero settings and video upload guidance.
-- Connects fixed language keys to the shared editor and public Home hero.
-- Replaces only untouched earlier guidance and preserves reviewed site wording.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en, old_fi, old_en) AS (
    VALUES
        ('site_front_page_title', '', '', NULL::text, NULL::text),
        ('site_front_page_slogan', '', '', NULL::text, NULL::text),
        ('front_page_show_blocks', 'Näytä etusivun lohkot', 'Show Home boxes', NULL::text, NULL::text),
        ('front_page_hero', 'Etusivun otsikko ja iskulause', 'Home title and slogan', NULL::text, NULL::text),
        ('front_page_hero_help', 'Tyhjä otsikko käyttää sivuston nimeä. Tyhjää iskulausetta ei näytetä.', 'An empty title uses the site name. An empty slogan is hidden.', NULL::text, NULL::text),
        ('error_setting_boolean_invalid', 'Valitse asetukselle totuusarvo: käytössä tai poissa käytöstä.', 'Choose a boolean setting: enabled or disabled.', NULL::text, NULL::text),
        ('front_page_background', 'Taustakuva tai video', 'Background image or video', 'Taustakuva', 'Background image'),
        ('front_page_remove_background', 'Poista tausta', 'Remove background', 'Poista taustakuva', 'Remove background'),
        ('front_page_upload_background', 'Valitse taustakuva tai video', 'Choose a background image or video', 'Valitse taustakuvatiedosto', 'Choose a background image file'),
        ('front_page_background_help', 'Sivuston yhteinen tausta. PNG, JPEG tai WebP, alle 10 Mt; MP4 tai WebM, alle 50 Mt. Valitse kohdistuspiste prosentteina.', 'One background for the site. PNG, JPEG or WebP under 10 MiB; MP4 or WebM under 50 MiB. Set its focal point as percentages.', 'Sivuston yhteinen taustakuva. PNG, JPEG tai WebP, alle 10 Mt. Valitse kuvan kohdistuspiste prosentteina.', 'One background for the site. PNG, JPEG or WebP, under 10 MB. Set its focal point as percentages.'),
        ('front_page_background_invalid', 'Valitse PNG-, JPEG- tai WebP-kuva (alle 10 Mt) tai MP4- tai WebM-video (alle 50 Mt).', 'Choose a PNG, JPEG or WebP image (under 10 MiB) or an MP4 or WebM video (under 50 MiB).', 'Valitse PNG-, JPEG- tai WebP-kuva, jonka koko on alle 10 Mt.', 'Choose a PNG, JPEG or WebP image under 10 MB.'),
        ('front_page_background_error', 'Tallennettu tausta-asetus on virheellinen. Vaihda tausta tai poista se.', 'The saved background setting is invalid. Replace or remove it.', 'Tallennettu taustakuva-asetus on virheellinen. Vaihda kuva tai poista se.', 'The saved background setting is invalid. Replace or remove it.'),
        ('front_page_background_save_failed', 'Taustaa ei voitu tallentaa. Tarkista tiedosto ja yritä uudelleen.', 'The background could not be saved. Check the file and try again.', 'Taustakuvaa ei voitu tallentaa. Tarkista kuva ja yritä uudelleen.', 'The background could not be saved. Check the image and try again.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL156 Home hero and presentation copy.' FROM authored_keys
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

-- Empty hero copy is intentional; register its use so catalog cleanup retains it.
INSERT INTO public.system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen,usage_explanation)
SELECT id,'front_page_hero',lang_key,'front_page_hero',CURRENT_DATE,
       'Home hero: an empty title uses the site name; an empty slogan is hidden.'
FROM public.system_lang_keys WHERE lang_key IN ('site_front_page_title','site_front_page_slogan')
ON CONFLICT(lang_key_id,source_type,source_high) DO NOTHING;
