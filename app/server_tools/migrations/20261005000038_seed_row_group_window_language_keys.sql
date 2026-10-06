-- 20261005000038_seed_row_group_window_language_keys.sql
-- Seeds Finnish and English administrator classification-window copy.
-- Connects names, assignments and recoverable editor failures to translated copy.
-- Exists to keep classifications multilingual without overwriting reviewed site wording.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('row_group_window_name_fi', 'Nimi suomeksi', 'Finnish name'),
        ('row_group_window_name_en', 'Nimi englanniksi', 'English name'),
        ('row_group_window_slug', 'Pysyvä tunniste', 'Permanent identifier'),
        ('row_group_window_type', 'Tyyppi', 'Type'),
        ('row_group_window_order', 'Järjestys', 'Order'),
        ('row_group_window_enabled', 'Käytössä', 'Enabled'),
        ('row_group_window_edit_names', 'Muokkaa nimeä ja asetuksia', 'Edit name and settings'),
        ('row_group_window_new_heading', 'Uusi luokittelu', 'New heading'),
        ('row_group_window_new_value', 'Uusi arvo', 'New value'),
        ('row_group_window_without_heading', 'Ilman luokittelua', 'Without a heading'),
        ('row_group_window_names_only', 'Valitse rivejä kohdistamista varten. Voit nyt muokata nimiä ja asetuksia.', 'Select rows to assign values. You can currently edit names and settings.'),
        ('row_group_window_selected_rows', 'Kohdista arvot valituille riveille', 'Assign values to the selected rows'),
        ('row_group_window_mixed', 'Osalla riveistä', 'On some rows'),
        ('row_group_window_clear_assignment', 'Tyhjennä tämän luokan arvot valituilta riveiltä', 'Clear this class on the selected rows'),
        ('row_group_window_maximum_rows', 'Valitse enintään 200 riviä kerralla.', 'Select at most 200 rows at a time.'),
        ('row_group_window_invalid_response', 'Palvelimen vastaus oli puutteellinen. Luokituksia ei voitu vahvistaa.', 'The server response was incomplete. Classifications could not be verified.'),
        ('row_group_window_load_failed', 'Luokkia ja kategorioita ei voitu ladata. Sulje ikkuna ja yritä uudelleen.', 'Classes and categories could not be loaded. Close the window and try again.'),
        ('row_group_window_save_failed', 'Tallennus ei onnistunut. Muokkaukset säilyivät; tarkista nimet ja tunnisteet ja yritä uudelleen. Jo tallennetut muutokset jäävät voimaan.', 'Saving failed. Your draft was kept; check names and identifiers and try again. Changes already saved remain in effect.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL103 S3 administrator classification window; Finnish and English copy (K175).' FROM authored_keys
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
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL;
