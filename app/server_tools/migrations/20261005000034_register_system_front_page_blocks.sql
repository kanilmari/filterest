-- 20261005000034_register_system_front_page_blocks.sql
-- Registers front page blocks as a protected system dataset after folders and metadata exist.
-- Connects upgrades and fresh installations with the same registry and column definitions.
-- Exists so front page blocks cannot be dropped or changed through generic dataset tools.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: system_front_page_blocks_registry

DO $front_page_registry$
DECLARE
    system_folder integer;
    registered_uid integer;
BEGIN
    SELECT id INTO system_folder FROM public.system_table_folders
     WHERE folder_name = 'system' ORDER BY id LIMIT 1;
    IF system_folder IS NULL THEN
        RAISE EXCEPTION 'system_front_page_blocks registration requires the system folder';
    END IF;
    INSERT INTO public.system_db_tables
        (table_name, schema_name, folder_id, is_removable, description, cached_oid,
         fk_display_column, filterbar_visible_by_default, display_name, sql_dump_policy)
    SELECT 'system_front_page_blocks', 'public', system_folder, FALSE, 'Common and account-specific front page blocks',
           'public.system_front_page_blocks'::regclass::oid::integer, 'table_uid', FALSE, 'Home blocks', 'all'
     WHERE NOT EXISTS (SELECT 1 FROM public.system_db_tables
        WHERE table_name = 'system_front_page_blocks' AND coalesce(NULLIF(schema_name, ''), 'public') = 'public');
    SELECT table_uid INTO STRICT registered_uid FROM public.system_db_tables
     WHERE table_name = 'system_front_page_blocks' AND coalesce(NULLIF(schema_name, ''), 'public') = 'public';
    UPDATE public.system_db_tables
       SET folder_id = system_folder, is_removable = FALSE,
           cached_oid = 'public.system_front_page_blocks'::regclass::oid::integer
     WHERE table_uid = registered_uid
       AND (folder_id IS DISTINCT FROM system_folder OR is_removable IS DISTINCT FROM FALSE
            OR cached_oid IS DISTINCT FROM 'public.system_front_page_blocks'::regclass::oid::integer);
    INSERT INTO public.system_column_details
        (table_uid, column_name, data_type, co_number, lang_key, insertable, editable_in_ui)
    SELECT registered_uid, columns.column_name, columns.data_type, columns.ordinal_position,
           columns.column_name, FALSE, FALSE
      FROM information_schema.columns AS columns
     WHERE columns.table_schema = 'public' AND columns.table_name = 'system_front_page_blocks'
       AND NOT EXISTS (SELECT 1 FROM public.system_column_details AS existing
            WHERE existing.table_uid = registered_uid AND existing.column_name = columns.column_name)
     ORDER BY columns.ordinal_position;
    UPDATE public.system_column_details SET insertable = FALSE, editable_in_ui = FALSE
     WHERE table_uid = registered_uid AND (insertable IS DISTINCT FROM FALSE OR editable_in_ui IS DISTINCT FROM FALSE);
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 'system_front_page_blocks_registry', 'completed',
           jsonb_build_object('file', '20261005000034_register_system_front_page_blocks.sql')
     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
        WHERE migration = 'system_front_page_blocks_registry' AND action = 'completed');
END
$front_page_registry$;
