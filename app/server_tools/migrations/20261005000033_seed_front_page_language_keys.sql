-- 20261005000033_seed_front_page_language_keys.sql
-- Seeds Finnish and English front page actions and labels.
-- Connects the front page and its administrator editor to translated copy.
-- Exists to keep the front page multilingual without overwriting reviewed site wording.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('front_page', 'Etusivu', 'Home'),
        ('front_page_settings', 'Etusivun asetukset', 'Home settings'),
        ('front_page_common', 'Yhteinen etusivu', 'Common home'),
        ('front_page_user_scope', 'Käyttäjän etusivu', 'User home'),
        ('front_page_inherits', 'Käyttää yhteistä etusivua', 'Inherits common home'),
        ('front_page_reset', 'Palauta yhteiseen', 'Reset to common'),
        ('front_page_copy_common', 'Kopioi yhteinen', 'Copy common'),
        ('front_page_add_block', 'Lisää lohko', 'Add block'),
        ('front_page_result_limit', 'Rivien määrä', 'Row limit'),
        ('front_page_show_all', 'Näytä kaikki', 'Show all'),
        ('front_page_no_results', 'Ei tuloksia', 'No results'),
        ('front_page_load_failed', 'Etusivua ei voitu ladata. Yritä uudelleen.', 'Home could not be loaded. Try again.'),
        ('front_page_background', 'Taustakuva', 'Background image'),
        ('front_page_remove_background', 'Poista taustakuva', 'Remove background'),
        ('front_page_default_not_saved', 'Oletuslista, ei tallennettu', 'Default list, not saved'),
        ('front_page_hidden_for_user', 'Käyttäjä ei voi lukea tätä aineistoa', 'This user cannot read this dataset'),
        ('front_page_save_conflict', 'Etusivu muuttui. Lataa uudelleen ennen tallennusta.', 'Home changed. Reload before saving.'),
        ('front_page_enabled', 'Erillinen etusivu', 'Separate home page'),
        ('front_page_button_shows_site_name', 'Sivuston nimi etusivupainikkeessa', 'Site name on the Home button'),
        ('front_page_open', 'Avaa etusivu', 'Open Home'),
        ('front_page_reload', 'Lataa uudelleen', 'Reload'),
        ('front_page_loaded', 'Etusivun asetukset ladattu.', 'Home settings loaded.'),
        ('front_page_move_up', 'Siirrä ylös', 'Move up'),
        ('front_page_move_down', 'Siirrä alas', 'Move down'),
        ('front_page_remove_block', 'Poista lohko', 'Remove block'),
        ('front_page_blocks_help', 'Enintään 20 lohkoa. Jokaisessa voi näyttää 1–20 uusinta riviä. Tyhjä lista palauttaa oletuksen.', 'Up to 20 blocks, each showing 1–20 newest rows. An empty list restores the default.'),
        ('front_page_find_user', 'Etsi käyttäjä näyttönimellä', 'Find a user by display name'),
        ('front_page_choose_user', 'Valitse käyttäjä etusivun valikosta.', 'Choose a user from the home scope menu.'),
        ('front_page_no_users', 'Näyttönimellä ei löytynyt käyttäjiä.', 'No users found by that display name.'),
        ('front_page_user_search_failed', 'Käyttäjiä ei voitu hakea. Yritä uudelleen.', 'User search failed. Try again.'),
        ('front_page_limit_invalid', 'Rivien määrän on oltava kokonaisluku 1–20.', 'The row limit must be a whole number from 1 to 20.'),
        ('front_page_blocks_invalid', 'Valitse enintään 20 eri aineistoa, joissa on uusimmat rivit -lajittelu.', 'Choose up to 20 different datasets that support newest-row sorting.'),
        ('front_page_save_failed', 'Etusivun asetuksia ei voitu tallentaa. Muutokset ovat edelleen lomakkeessa.', 'Home settings could not be saved. Your changes are still in the form.'),
        ('front_page_refresh_failed', 'Muutokset tallennettiin, mutta asetuksia ei voitu ladata. Lataa uudelleen ennen seuraavaa tallennusta.', 'Changes were saved, but settings could not be loaded. Reload before saving again.'),
        ('front_page_discard_changes', 'Hylätäänkö tallentamattomat muutokset?', 'Discard unsaved changes?'),
        ('front_page_discard', 'Hylkää muutokset', 'Discard changes'),
        ('front_page_upload_background', 'Valitse taustakuvatiedosto', 'Choose a background image file'),
        ('front_page_background_help', 'Sivuston yhteinen taustakuva. PNG, JPEG tai WebP, alle 10 Mt. Valitse kuvan kohdistuspiste prosentteina.', 'One background for the site. PNG, JPEG or WebP, under 10 MB. Set its focal point as percentages.'),
        ('front_page_background_picker_help', 'Valitse kuva sivuston yhteiseksi etusivun taustaksi liittämällä kuvapalvelun kuvasivun osoite.', 'Paste a provider photo-page URL to choose a shared Home background for the site.'),
        ('front_page_background_error', 'Tallennettu taustakuva-asetus on virheellinen. Vaihda kuva tai poista se.', 'The saved background setting is invalid. Replace or remove it.'),
        ('front_page_background_invalid', 'Valitse PNG-, JPEG- tai WebP-kuva, jonka koko on alle 10 Mt.', 'Choose a PNG, JPEG or WebP image under 10 MB.'),
        ('front_page_background_save_failed', 'Taustakuvaa ei voitu tallentaa. Tarkista kuva ja yritä uudelleen.', 'The background could not be saved. Check the image and try again.'),
        ('front_page_focal_x', 'Kohdistuspiste vasemmalta (%)', 'Focal point from the left (%)'),
        ('front_page_focal_y', 'Kohdistuspiste ylhäältä (%)', 'Focal point from the top (%)'),
        ('front_page_focal_invalid', 'Kohdistuspisteen arvojen on oltava 0–100 prosenttia.', 'Focal point values must be from 0 to 100 percent.'),
        ('system_front_page_blocks', 'Etusivun lohkot', 'Home blocks')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL143 front page copy.' FROM authored_keys
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
