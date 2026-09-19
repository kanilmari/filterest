-- 20260919000005_seed_dataset_form_dimension_language_keys.sql
-- Adds the interface copy for the dataset dimensions both dataset forms now offer.
-- Bridges the shared folder, reading-rights, picture, deletion-protection and
-- foreign-key controls with the installation's own language keys.
-- Exists so those controls read from language keys instead of hardcoded copy.
-- Finnish and English are served from the columns of system_lang_keys, so the
-- authored copy is written there first and mirrored into the normalized table.
-- VERSION_DB: 9.7.16
-- VERSION_DB_OWNER: 20260918000001_record_site_assistant_release.sql

WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('dataset_folder_unavailable', 'Kansioita ei voitu lukea.', 'The folders could not be read.',
         'Dataset dimensions: the navigation folders could not be read.'),
        ('dataset_folder_save_failed', 'Kansion tallennus epäonnistui.', 'The folder could not be saved.',
         'Dataset dimensions: moving the dataset to another folder failed.'),
        ('dataset_folder_move_anyway', 'Siirrä silti', 'Move anyway',
         'Dataset dimensions: confirms a folder move the server asked about.'),
        ('dataset_permissions_loading', 'Luetaan lukuoikeuksia…', 'Reading the rights…',
         'Dataset dimensions: status while the dataset reading rights are being read.'),
        ('dataset_permissions_unavailable', 'Lukuoikeuksia ei voitu lukea.', 'The rights could not be read.',
         'Dataset dimensions: the dataset reading rights could not be read.'),
        ('dataset_permissions_save_failed', 'Lukuoikeuksien tallennus epäonnistui.', 'The rights could not be saved.',
         'Dataset dimensions: saving the dataset reading rights failed.'),
        ('dataset_images_unavailable', 'Kuva-asetusta ei voitu lukea.', 'The picture setting could not be read.',
         'Dataset dimensions: the picture-attachment setting could not be read.'),
        ('dataset_images_save_failed', 'Kuva-asetuksen tallennus epäonnistui.', 'The picture setting could not be saved.',
         'Dataset dimensions: saving the picture-attachment setting failed.'),
        ('dataset_deletion_protection_unavailable', 'Poistosuojausta ei voitu lukea.',
         'The deletion protection could not be read.',
         'Dataset dimensions: the deletion protection could not be read.'),
        ('dataset_foreign_keys_title', 'Linkit toisiin aineistoihin', 'Links to other datasets',
         'Dataset dimensions: heading of the links to other datasets.'),
        ('dataset_foreign_keys_none', 'Tällä aineistolla ei ole vielä linkkejä.', 'This dataset has no links yet.',
         'Dataset dimensions: the dataset has no links to other datasets yet.'),
        ('dataset_foreign_keys_unavailable', 'Linkkejä ei voitu lukea.', 'The links could not be read.',
         'Dataset dimensions: the links to other datasets could not be read.'),
        ('dataset_foreign_key_save_failed', 'Linkin lisääminen epäonnistui.', 'The link could not be added.',
         'Dataset dimensions: adding a link to another dataset failed.'),
        ('manage_table_settings_need_attention',
         'Sarakkeet tallennettiin. Yksi aineiston asetus jäi kesken – katso lomakkeen viesti.',
         'The columns were saved. One dataset setting still needs attention — see the message in the form.',
         'Dataset dimensions: the columns saved, but one dataset setting did not.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
SELECT lang_key, fi, en, creation_spec
FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

WITH selected_keys AS (
    SELECT id, fi, en
    FROM public.system_lang_keys
    WHERE creation_spec LIKE 'Dataset dimensions:%'
), authored_translations AS (
    SELECT selected.id AS lang_key_id, translations.language_code, translations.translation
    FROM selected_keys AS selected
    CROSS JOIN LATERAL (
        VALUES ('fi', selected.fi), ('en', selected.en)
    ) AS translations(language_code, translation)
    WHERE translations.translation IS NOT NULL
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT lang_key_id, language_code, translation, 'manual', 'approved'
FROM authored_translations
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    review_status = EXCLUDED.review_status,
    source_kind = EXCLUDED.source_kind,
    updated = now();
