-- 20261015000009_add_card_image_usage_presentation.sql
-- Stores presentation and a focal point on each image use, never on library assets.
-- The same installer serves upgrades, fresh bootstrap and newly enabled galleries.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql
-- COMPLETION_MARKER: wl69_card_image_usage_storage

CREATE OR REPLACE FUNCTION public.app_ensure_card_image_storage(dataset_uid integer)
RETURNS void LANGUAGE plpgsql AS $storage$
DECLARE dataset_name text; field_name text;
BEGIN
    SELECT table_name INTO STRICT dataset_name FROM public.system_db_tables
    WHERE table_uid=dataset_uid AND COALESCE(NULLIF(schema_name,''),'public')='public';
    EXECUTE format('ALTER TABLE public.%I
        ADD COLUMN IF NOT EXISTS card_image_presentation text,
        ADD COLUMN IF NOT EXISTS card_image_focal_x numeric(5,4),
        ADD COLUMN IF NOT EXISTS card_image_focal_y numeric(5,4)', dataset_name);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid=to_regclass(format('public.%I',dataset_name))
          AND conname='card_image_usage_valid') THEN
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT card_image_usage_valid CHECK (
            (card_image_presentation IS NULL OR card_image_presentation IN (''cover'',''contain'',''contain_blur''))
            AND ((card_image_focal_x IS NULL) = (card_image_focal_y IS NULL))
            AND (card_image_focal_x IS NULL OR card_image_focal_x BETWEEN 0 AND 1)
            AND (card_image_focal_y IS NULL OR card_image_focal_y BETWEEN 0 AND 1))',dataset_name);
    END IF;
    FOREACH field_name IN ARRAY ARRAY['card_image_presentation','card_image_focal_x','card_image_focal_y'] LOOP
        INSERT INTO public.system_column_details(table_uid,column_name,data_type,co_number,
            editable_in_ui,insertable,card_element,hide_in_filter_panel,show_value_on_card,hide_everywhere)
        SELECT dataset_uid,field_name,c.data_type,c.ordinal_position,true,false,'hidden',true,false,true
        FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=dataset_name
          AND c.column_name=field_name AND NOT EXISTS (
            SELECT 1 FROM public.system_column_details d WHERE d.table_uid=dataset_uid AND d.column_name=field_name);
    END LOOP;
END $storage$;

DO $upgrade$
DECLARE gallery record;
    -- Go's strings.TrimSpace includes these Unicode spaces as well as ASCII whitespace.
    trim_space constant text := E' \t\n\r\f' || chr(11) || chr(133) || chr(160) || chr(5760)
        || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197)
        || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202)
        || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288);
BEGIN
    -- Mirrors the registered image-profile discovery, including legacy image relations.
    FOR gallery IN SELECT DISTINCT c.table_uid
        FROM public.system_foreign_key_relations_1_m r
        JOIN public.system_db_tables c ON c.table_uid=r.source_table_uid
        WHERE COALESCE(NULLIF(c.schema_name,''),'public')='public'
          AND (r.target_insert_specs->'file_upload'->'profiles' ? 'image'
            OR lower(btrim(r.target_insert_specs->'file_upload'->>'profile_key',trim_space))='image'
            OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE
                WHEN jsonb_typeof(r.target_insert_specs->'file_upload'->'asset_kinds')='array'
                THEN r.target_insert_specs->'file_upload'->'asset_kinds' ELSE '[]'::jsonb END) AS kinds(kind)
                WHERE lower(btrim(kind,trim_space))='image')
            OR lower(btrim(r.target_insert_specs->'file_upload'->>'target_directory',trim_space))='media'
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE
                WHEN jsonb_typeof(r.target_insert_specs->'file_upload'->'cache_targets')='array'
                THEN r.target_insert_specs->'file_upload'->'cache_targets' ELSE '[]'::jsonb END) AS targets(target)
                WHERE lower(btrim(target->>'column',trim_space))='cached_image')
            OR ((r.target_insert_specs->'file_upload' IS NULL OR r.target_insert_specs->'file_upload'='null'::jsonb)
              AND EXISTS (SELECT 1 FROM information_schema.columns a WHERE a.table_schema='public'
                AND a.table_name=c.table_name AND a.column_name='asset_kind')
              AND EXISTS (SELECT 1 FROM information_schema.columns f WHERE f.table_schema='public'
                AND f.table_name=c.table_name AND f.column_name IN ('filename','stored_filename','original_name'))))
    LOOP
        PERFORM public.app_ensure_card_image_storage(gallery.table_uid);
    END LOOP;
    INSERT INTO public.system_data_repair_records(migration,action)
    SELECT 'wl69_card_image_usage_storage','completed' WHERE NOT EXISTS (
        SELECT 1 FROM public.system_data_repair_records WHERE migration='wl69_card_image_usage_storage' AND action='completed');
END $upgrade$;
