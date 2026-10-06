-- 20261005000080_add_dataset_media_hidden.sql
-- Adds independent visibility to stored dataset cover and background images (WL153).
-- Connects the media registry and header editor with upgrade and bootstrap metadata.
-- Keeps files and links intact; the browser suppresses hidden images at display time.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: dataset_media_hidden

ALTER TABLE public.system_dataset_media
    ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.system_dataset_media.hidden IS
    'Suppresses presentation loading without removing the stored image or its link. Admin previews remain visible.';

-- Run after the registry exists, including in the fresh-install bootstrap seed.
DO $media_hidden_metadata$
DECLARE
    registered_table_uid INTEGER;
BEGIN
    SELECT table_uid INTO STRICT registered_table_uid
    FROM public.system_db_tables
    WHERE table_name = 'system_dataset_media'
      AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public';

    INSERT INTO public.system_column_details (
        table_uid, column_name, data_type, co_number, editable_in_ui, created, updated
    )
    SELECT registered_table_uid, columns.column_name, columns.data_type,
           columns.ordinal_position, FALSE, now(), now()
    FROM information_schema.columns AS columns
    WHERE columns.table_schema = 'public'
      AND columns.table_name = 'system_dataset_media'
      AND columns.column_name = 'hidden'
      AND NOT EXISTS (
          SELECT 1 FROM public.system_column_details AS existing
          WHERE existing.table_uid = registered_table_uid
            AND existing.column_name = columns.column_name
      );
    UPDATE public.system_column_details SET editable_in_ui = FALSE
    WHERE table_uid = registered_table_uid AND column_name = 'hidden'
      AND editable_in_ui IS DISTINCT FROM FALSE;
END
$media_hidden_metadata$;

-- Finnish and English only (owner K175). Preserve reviewed installation copy,
-- and mirror the served columns into the normalized translations as in the
-- dataset header language-key seed of 20260922000007.
WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('dataset_header_config_hide_cover_image', 'Piilota kansikuva', 'Hide cover image',
         'Dataset header settings: hide the cover without deleting its file or link.'),
        ('dataset_header_config_hide_background_image', 'Piilota taustakuva', 'Hide background image',
         'Dataset header settings: hide the content background without deleting its file or link.'),
        ('dataset_header_config_image_hidden', 'Piilotettu', 'Hidden',
         'Dataset header settings: badge on the preview of an image hidden from dataset pages.')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, creation_spec FROM authored_keys
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
    SELECT id, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key)
    WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM served_keys AS served
CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO NOTHING;

INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'dataset_media_hidden', 'completed',
       jsonb_build_object('file', '20261005000080_add_dataset_media_hidden.sql')
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'dataset_media_hidden' AND action = 'completed');
