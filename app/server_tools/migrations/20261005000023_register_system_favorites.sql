-- 20261005000023_register_system_favorites.sql
-- Registers favorites as a protected system dataset after folders and metadata exist.
-- Connects upgrades and fresh installations with the same registry and column definitions.
-- Exists so favorites cannot be dropped or changed through generic dataset tools.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql
-- COMPLETION_MARKER: system_favorites_registry

DO $favorites_registry$
DECLARE
    system_folder integer;
    registered_uid integer;
BEGIN
    SELECT id INTO system_folder FROM public.system_table_folders
     WHERE folder_name = 'system' ORDER BY id LIMIT 1;
    IF system_folder IS NULL THEN
        RAISE EXCEPTION 'system_favorites registration requires the system folder';
    END IF;
    INSERT INTO public.system_db_tables
        (table_name, schema_name, folder_id, is_removable, description, cached_oid,
         fk_display_column, filterbar_visible_by_default, display_name, sql_dump_policy)
    SELECT 'system_favorites', 'public', system_folder, FALSE, 'Account-owned typed favorites',
           'public.system_favorites'::regclass::oid::integer, 'target_key', FALSE, 'Favorites', 'all'
     WHERE NOT EXISTS (SELECT 1 FROM public.system_db_tables
        WHERE table_name = 'system_favorites' AND coalesce(NULLIF(schema_name, ''), 'public') = 'public');
    SELECT table_uid INTO STRICT registered_uid FROM public.system_db_tables
     WHERE table_name = 'system_favorites' AND coalesce(NULLIF(schema_name, ''), 'public') = 'public';
    UPDATE public.system_db_tables
       SET folder_id = system_folder, is_removable = FALSE,
           cached_oid = 'public.system_favorites'::regclass::oid::integer
     WHERE table_uid = registered_uid
       AND (folder_id IS DISTINCT FROM system_folder OR is_removable IS DISTINCT FROM FALSE
            OR cached_oid IS DISTINCT FROM 'public.system_favorites'::regclass::oid::integer);
    INSERT INTO public.system_column_details
        (table_uid, column_name, data_type, co_number, lang_key, insertable, editable_in_ui)
    SELECT registered_uid, columns.column_name, columns.data_type, columns.ordinal_position,
           columns.column_name, FALSE, FALSE
      FROM information_schema.columns AS columns
     WHERE columns.table_schema = 'public' AND columns.table_name = 'system_favorites'
       AND NOT EXISTS (SELECT 1 FROM public.system_column_details AS existing
            WHERE existing.table_uid = registered_uid AND existing.column_name = columns.column_name)
     ORDER BY columns.ordinal_position;
    UPDATE public.system_column_details SET insertable = FALSE, editable_in_ui = FALSE
     WHERE table_uid = registered_uid AND (insertable IS DISTINCT FROM FALSE OR editable_in_ui IS DISTINCT FROM FALSE);
    INSERT INTO public.system_data_repair_records (migration, action, detail)
    SELECT 'system_favorites_registry', 'completed',
           jsonb_build_object('file', '20261005000023_register_system_favorites.sql')
     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
        WHERE migration = 'system_favorites_registry' AND action = 'completed');
END
$favorites_registry$;
