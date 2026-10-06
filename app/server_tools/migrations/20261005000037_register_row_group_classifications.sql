-- 20261005000037_register_row_group_classifications.sql
-- Registers classification headings as a protected system dataset after folders and metadata exist.
-- Connects upgrades and fresh installations with the same registry and column definitions.
-- Exists so headings cannot be dropped or changed through generic dataset tools.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: wl103_row_group_classifications_registry

DO $classifications_registry$
DECLARE
    system_folder integer;
    registered_uid integer;
BEGIN
    SELECT id INTO system_folder FROM public.system_table_folders
     WHERE folder_name = 'system' ORDER BY id LIMIT 1;
    IF system_folder IS NULL THEN
        RAISE EXCEPTION 'system_row_group_classifications registration requires the system folder';
    END IF;
    INSERT INTO public.system_db_tables
        (table_name, schema_name, folder_id, is_removable, description, cached_oid,
         fk_display_column, filterbar_visible_by_default, display_name, sql_dump_policy)
    SELECT 'system_row_group_classifications', 'public', system_folder, FALSE, 'Multilingual row-group classification headings',
           'public.system_row_group_classifications'::regclass::oid::integer, 'slug', FALSE, 'Classifications', 'all'
     WHERE NOT EXISTS (SELECT 1 FROM public.system_db_tables
        WHERE table_name = 'system_row_group_classifications' AND coalesce(NULLIF(schema_name, ''), 'public') = 'public');
    SELECT table_uid INTO STRICT registered_uid FROM public.system_db_tables
     WHERE table_name = 'system_row_group_classifications' AND coalesce(NULLIF(schema_name, ''), 'public') = 'public';
    UPDATE public.system_db_tables
       SET folder_id = system_folder, is_removable = FALSE,
           cached_oid = 'public.system_row_group_classifications'::regclass::oid::integer
     WHERE table_uid = registered_uid
       AND (folder_id IS DISTINCT FROM system_folder OR is_removable IS DISTINCT FROM FALSE
            OR cached_oid IS DISTINCT FROM 'public.system_row_group_classifications'::regclass::oid::integer);
    INSERT INTO public.system_column_details
        (table_uid, column_name, data_type, co_number, lang_key, insertable, editable_in_ui)
    SELECT registered_uid, columns.column_name, columns.data_type, columns.ordinal_position,
           columns.column_name, FALSE, FALSE
      FROM information_schema.columns AS columns
     WHERE columns.table_schema = 'public' AND columns.table_name = 'system_row_group_classifications'
       AND NOT EXISTS (SELECT 1 FROM public.system_column_details AS existing
            WHERE existing.table_uid = registered_uid AND existing.column_name = columns.column_name)
     ORDER BY columns.ordinal_position;
    UPDATE public.system_column_details SET insertable = FALSE, editable_in_ui = FALSE
     WHERE table_uid = registered_uid AND (insertable IS DISTINCT FROM FALSE OR editable_in_ui IS DISTINCT FROM FALSE);
    INSERT INTO public.system_column_details
        (table_uid, column_name, data_type, co_number, lang_key, insertable, editable_in_ui)
    SELECT tables.table_uid, 'classification_id', columns.data_type, columns.ordinal_position,
           'system_row_group_classifications', FALSE, FALSE
      FROM public.system_db_tables AS tables
      JOIN information_schema.columns AS columns ON columns.table_schema = 'public'
       AND columns.table_name = 'system_row_groups' AND columns.column_name = 'classification_id'
     WHERE tables.table_name = 'system_row_groups'
       AND coalesce(NULLIF(tables.schema_name, ''), 'public') = 'public'
       AND NOT EXISTS (SELECT 1 FROM public.system_column_details AS existing
            WHERE existing.table_uid = tables.table_uid AND existing.column_name = 'classification_id');
    -- A fresh bootstrap may already have described this additive physical column.
    -- Give that row the same protected metadata as the upgrade inserts above.
    UPDATE public.system_column_details AS columns
       SET lang_key = 'system_row_group_classifications', insertable = FALSE, editable_in_ui = FALSE
      FROM public.system_db_tables AS tables
     WHERE columns.table_uid = tables.table_uid AND columns.column_name = 'classification_id'
       AND tables.table_name = 'system_row_groups'
       AND coalesce(NULLIF(tables.schema_name, ''), 'public') = 'public'
       AND (columns.lang_key IS DISTINCT FROM 'system_row_group_classifications'
            OR columns.insertable IS DISTINCT FROM FALSE OR columns.editable_in_ui IS DISTINCT FROM FALSE);
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 'wl103_row_group_classifications_registry', 'completed',
           jsonb_build_object('file', '20261005000037_register_row_group_classifications.sql')
     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
        WHERE migration = 'wl103_row_group_classifications_registry' AND action = 'completed');
END
$classifications_registry$;
