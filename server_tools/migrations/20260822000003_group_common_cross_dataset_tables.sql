-- 20260822000003_group_common_cross_dataset_tables.sql
-- Places cross-dataset functional tables under database/system/common.
-- Keeps generic comments and row groups independent of app_, dev_, and system_ target prefixes.
-- VERSION_DB: 9.3.0
-- VERSION_DB_OWNER: 20260822000001_create_system_row_groups.sql

DO $$
DECLARE
    database_folder_id BIGINT;
    system_folder_id BIGINT;
    common_folder_id BIGINT;
BEGIN
    SELECT id INTO database_folder_id
    FROM public.system_table_folders
    WHERE folder_name = 'database'
      AND parent_id IS NULL
    ORDER BY id
    LIMIT 1;

    IF database_folder_id IS NULL THEN
        RAISE EXCEPTION 'Common system-table grouping requires the database root folder';
    END IF;

    SELECT id INTO system_folder_id
    FROM public.system_table_folders
    WHERE folder_name = 'system'
      AND parent_id = database_folder_id
    ORDER BY id
    LIMIT 1;

    IF system_folder_id IS NULL THEN
        RAISE EXCEPTION 'Common system-table grouping requires the database/system folder';
    END IF;

    INSERT INTO public.system_table_folders (
        folder_name,
        folder_description,
        created,
        updated,
        parent_id,
        creation_spec,
        is_current_project,
        admin_user_id,
        tab_order_json
    )
    SELECT
        'common',
        'Cross-dataset platform features shared by app, development, and system datasets',
        CURRENT_DATE,
        CURRENT_DATE,
        system_folder_id,
        'Filterest DB 9.3.0 common cross-dataset system tables',
        FALSE,
        NULL,
        '[]'::jsonb
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.system_table_folders
        WHERE folder_name = 'common'
          AND parent_id = system_folder_id
    );

    SELECT id INTO common_folder_id
    FROM public.system_table_folders
    WHERE folder_name = 'common'
      AND parent_id = system_folder_id
    ORDER BY id
    LIMIT 1;

    UPDATE public.system_db_tables
    SET folder_id = common_folder_id,
        updated = now()
    WHERE table_name IN (
        'system_comments',
        'system_row_groups',
        'system_row_group_memberships'
    )
      AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
      AND folder_id IS DISTINCT FROM common_folder_id;
END $$;
